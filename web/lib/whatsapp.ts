import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';

type IncomingMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  context?: { id?: string };
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  document?: { id?: string; mime_type?: string; sha256?: string; caption?: string; filename?: string };
};

export type IntakeRow = {
  id: number; messageId: number; receivedAt: string; reporter: string; reporterKnown: boolean;
  profileName: string | null; type: string; text: string | null; hasMedia: boolean;
  mediaMime: string | null; status: string; error: string | null;
};

const normalizeWaId = (value: string) => `+${value.replace(/\D/g, '')}`;

export function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const received = Buffer.from(signature.slice(7));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function messageContent(message: IncomingMessage) {
  if (message.type === 'image' && message.image) {
    return { text: message.image.caption ?? null, media: message.image };
  }
  if (message.type === 'document' && message.document) {
    return { text: message.document.caption ?? null, media: message.document };
  }
  return { text: message.text?.body ?? null, media: null };
}

async function downloadMedia(mediaId: string, messageDbId: number, mimeType?: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0';
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
  const metadataResponse = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metadataResponse.ok) throw new Error(`Meta no entregó la ubicación del archivo (${metadataResponse.status})`);
  const metadata = await metadataResponse.json() as { url?: string };
  if (!metadata.url) throw new Error('Meta no devolvió URL para el archivo');
  const fileResponse = await fetch(metadata.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileResponse.ok) throw new Error(`No se pudo descargar el archivo (${fileResponse.status})`);
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('El archivo excede 20 MB');
  const extension = mimeType?.includes('pdf') ? 'pdf' : mimeType?.includes('png') ? 'png' : 'jpg';
  const root =
    process.env.WHATSAPP_MEDIA_DIR ??
    (process.env.VERCEL ? '/tmp/kw2-whatsapp' : path.resolve(process.cwd(), '..', 'data', 'whatsapp'));
  const folder = new Date().toISOString().slice(0, 7);
  await mkdir(path.join(root, folder), { recursive: true });
  const storageKey = `${folder}/${messageDbId}.${extension}`;
  await writeFile(path.join(root, storageKey), bytes, { mode: 0o600 });
  return storageKey;
}

export async function processWebhook(payload: any) {
  const messages: Array<{ message: IncomingMessage; metadata: any; contact: any }> = [];
  for (const entry of payload?.entry ?? []) for (const change of entry?.changes ?? []) {
    const value = change?.value;
    for (const message of value?.messages ?? []) {
      const contact = (value?.contacts ?? []).find((item: any) => item.wa_id === message.from);
      messages.push({ message, metadata: value?.metadata ?? {}, contact });
    }
  }

  let created = 0;
  for (const item of messages) {
    const { message, metadata, contact } = item;
    const content = messageContent(message);
    const sender = normalizeWaId(message.from);
    const reporter = await pool.query(
      `SELECT id FROM whatsapp_reporters WHERE phone_e164=$1 AND status='active'`, [sender],
    );
    const inserted = await pool.query(
      `INSERT INTO whatsapp_messages
       (whatsapp_message_id, phone_number_id, sender_wa_id, sender_profile_name, reporter_id,
        message_type, message_text, media_id, media_mime_type, media_sha256, reply_to_message_id,
        received_at, processing_status, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12::bigint),$13,$14)
       ON CONFLICT (whatsapp_message_id) DO UPDATE SET raw_payload=EXCLUDED.raw_payload, updated_at=now()
       RETURNING id, (xmax = 0) inserted`,
      [message.id, metadata.phone_number_id ?? null, sender, contact?.profile?.name ?? null,
       reporter.rows[0]?.id ?? null, message.type, content.text, content.media?.id ?? null,
       content.media?.mime_type ?? null, content.media?.sha256 ?? null, message.context?.id ?? null,
       message.timestamp, content.media?.id ? 'received' : 'ready', JSON.stringify(item)],
    );
    if (inserted.rows[0].inserted) created++;
    const dbId = Number(inserted.rows[0].id);
    await pool.query(
      `INSERT INTO operation_intakes (whatsapp_message_id, reported_by_id, source_text, status)
       VALUES ($1,$2,$3,$4) ON CONFLICT (whatsapp_message_id) DO NOTHING`,
      [dbId, reporter.rows[0]?.id ?? null, content.text, reporter.rows[0]?.id ? 'received' : 'needs_information'],
    );
    if (content.media?.id) {
      const stored = await pool.query(`SELECT media_storage_key FROM whatsapp_messages WHERE id=$1`, [dbId]);
      if (stored.rows[0]?.media_storage_key) continue;
      try {
        const key = await downloadMedia(content.media.id, dbId, content.media.mime_type);
        await pool.query(`UPDATE whatsapp_messages SET media_storage_key=$2, processing_status='media_downloaded', updated_at=now() WHERE id=$1`, [dbId, key]);
      } catch (error: any) {
        await pool.query(`UPDATE whatsapp_messages SET processing_status='failed', processing_error=$2, updated_at=now() WHERE id=$1`, [dbId, error.message]);
      }
    }
  }
  return { received: messages.length, created };
}

export async function listIntakes(): Promise<IntakeRow[]> {
  const result = await pool.query(
    `SELECT oi.id, wm.id message_id, wm.received_at, wr.display_name reporter,
            wm.reporter_id IS NOT NULL reporter_known, wm.sender_profile_name, wm.message_type,
            wm.message_text, wm.media_id IS NOT NULL has_media, wm.media_mime_type,
            oi.status, wm.processing_error
     FROM operation_intakes oi
     JOIN whatsapp_messages wm ON wm.id=oi.whatsapp_message_id
     LEFT JOIN whatsapp_reporters wr ON wr.id=wm.reporter_id
     ORDER BY wm.received_at DESC LIMIT 250`,
  );
  return result.rows.map((row: any) => ({
    id: Number(row.id), messageId: Number(row.message_id), receivedAt: row.received_at,
    reporter: row.reporter ?? row.sender_profile_name ?? 'Remitente no reconocido', reporterKnown: row.reporter_known,
    profileName: row.sender_profile_name, type: row.message_type, text: row.message_text,
    hasMedia: row.has_media, mediaMime: row.media_mime_type, status: row.status, error: row.processing_error,
  }));
}
