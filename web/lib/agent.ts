// Agente local de solo lectura (Nivel 1). Usa el modelo local (Ollama, qwen3)
// SOLO como interfaz: interpreta la pregunta, llama herramientas deterministas
// y redacta la respuesta. Nunca inventa cifras; todo numero viene de las tools.
import { findClients, clientDetail } from './agent-tools';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.KW2_AGENT_MODEL ?? 'qwen3:8b';

const SYSTEM = `Eres el asistente de solo lectura de la mesa de cambio KW2. Respondes SIEMPRE en español, en 2-4 frases, directo.
Reglas:
- NUNCA inventes cifras. Usa SIEMPRE las herramientas y básate SOLO en lo que devuelven (no agregues análisis ni código).
- Responde la pregunta del usuario directamente con los datos del resumen de la herramienta.
- Di si el cliente es deudor (saldo negativo, debe a KW2) o acreedor (saldo positivo, KW2 le debe) y el monto.
- Si la herramienta devuelve "candidatos", pide al usuario que precise el nombre.
Ejemplo de respuesta: "Sergio es deudor: debe USD 2.859,96 a KW2 (20 movimientos). Por ejemplo, un egreso de USD 500 el 2026-01-02 por BDV SOLUCIONES (kw2_id KW2-NJ46R85)."`;

const tools = [
  {
    type: 'function',
    function: {
      name: 'consultar_saldo_cliente',
      description:
        'Devuelve el saldo de un cliente y los movimientos que lo forman, con evidencia. Úsala para "¿cuánto debe X?", "¿cuánto se le debe a X?", "saldo de X".',
      parameters: {
        type: 'object',
        properties: { nombre: { type: 'string', description: 'nombre o parte del nombre del cliente' } },
        required: ['nombre'],
      },
    },
  },
];

async function runTool(name: string, args: any): Promise<unknown> {
  if (name === 'consultar_saldo_cliente') {
    const nombre = String(args?.nombre ?? '').trim();
    if (!nombre) return { error: 'falta el nombre del cliente' };
    const matches = await findClients(nombre);
    if (matches.length === 0) return { error: `no se encontró ningún cliente que contenga "${nombre}"` };
    const exact = matches.find((m) => m.name.toLowerCase() === nombre.toLowerCase());
    const chosen = exact ?? (matches.length === 1 ? matches[0] : null);
    if (!chosen) return { candidatos: matches.slice(0, 10).map((m) => m.name), nota: 'varios clientes coinciden; pide precisión' };
    const d = await clientDetail(chosen.legacyId);
    if (!d) return { error: 'sin datos' };
    // Resumen compacto orientado a la respuesta (no la lista cruda completa).
    const entradas = d.movimientos.filter((m) => m.direction === 'inflow').reduce((s, m) => s + m.usd, 0);
    const salidas = d.movimientos.filter((m) => m.direction === 'outflow').reduce((s, m) => s + m.usd, 0);
    const ejemplos = [...d.movimientos].sort((a, b) => b.usd - a.usd).slice(0, 4)
      .map((m) => ({ fecha: m.date, cuenta: m.account, direccion: m.direction === 'inflow' ? 'entra' : 'sale', usd: m.usd, kw2_id: m.kw2id }));
    return {
      cliente: d.name,
      saldo_usd: d.balance,
      rol: d.balance < 0 ? 'deudor (debe a KW2)' : d.balance > 0 ? 'acreedor (KW2 le debe)' : 'en cero',
      total_movimientos: d.movimientos.length,
      total_entradas_usd: Math.round(entradas * 100) / 100,
      total_salidas_usd: Math.round(salidas * 100) / 100,
      ejemplos,
    };
  }
  return { error: `herramienta desconocida: ${name}` };
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export type AgentResult = { answer: string; toolCalls: { name: string; args: unknown; result: unknown }[] };

export async function askAgent(question: string): Promise<AgentResult> {
  const messages: any[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: question },
  ];
  const toolCalls: AgentResult['toolCalls'] = [];

  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, tools, stream: false, think: false, options: { temperature: 0.2 } }),
    });
    if (!res.ok) throw new Error(`Ollama respondió ${res.status}. ¿Está corriendo y el modelo descargado?`);
    const data = await res.json();
    const msg = data.message;
    messages.push(msg);

    if (msg?.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const args = tc.function.arguments;
        const result = await runTool(tc.function.name, args);
        toolCalls.push({ name: tc.function.name, args, result });
        messages.push({ role: 'tool', name: tc.function.name, content: JSON.stringify(result) });
      }
      // Empujón: que responda la pregunta original en español con estos datos.
      messages.push({ role: 'user', content: 'Con esos datos, responde mi pregunta en español, en 2-4 frases, sin código ni análisis extra.' });
      continue;
    }
    return { answer: stripThink(msg?.content ?? ''), toolCalls };
  }
  return { answer: 'No pude completar la consulta (demasiados pasos).', toolCalls };
}
