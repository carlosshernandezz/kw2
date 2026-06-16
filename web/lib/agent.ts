// Agente local de solo lectura (Nivel 1). Usa el modelo local (Ollama, qwen3)
// SOLO como interfaz: interpreta la pregunta, llama herramientas deterministas
// y redacta la respuesta. Nunca inventa cifras; todo numero viene de las tools.
import { findClients, clientDetail, unreconciledBinance, unidentifiedZelle, utilidadMesa, topBalances, utilidadPeriodo, estadoConciliacion, buscarDuplicados } from './agent-tools';
import { needsReview } from './manual';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.KW2_AGENT_MODEL ?? 'qwen3:8b';

const SYSTEM = `Eres el asistente de solo lectura de la mesa de cambio KW2. Respondes SIEMPRE en español, en 2-4 frases, directo.
Reglas:
- NUNCA inventes cifras. Usa SIEMPRE las herramientas y básate SOLO en lo que devuelven (no agregues análisis ni código).
- No agregues montos, conteos ni fechas que no aparezcan literalmente en el resultado de la herramienta.
- Responde la pregunta del usuario directamente con los datos del resumen de la herramienta.
- Di si el cliente es deudor (saldo negativo, debe a KW2) o acreedor (saldo positivo, KW2 le debe) y el monto.
- Si la herramienta devuelve "candidatos", pide al usuario que precise el nombre.
- No incluyas ejemplos de movimientos individuales a menos que el usuario los pida.
Ejemplo de respuesta: "Sergio es deudor: debe USD 2.859,96 a KW2 (286 movimientos)."`;

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
  {
    type: 'function',
    function: {
      name: 'que_falta_conciliar',
      description: 'Cuántos movimientos del libro y filas del estado de cuenta de BINANCE CH faltan por conciliar. Úsala para "¿qué falta conciliar?", "¿cuánto queda por conciliar?".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'zelles_sin_identificar',
      description: 'Saldo del cliente "Sin Identificar" y cuántos alias Zelle están sin identificar. Úsala para "¿qué Zelles no están identificados?".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'utilidad_mesa',
      description: 'Utilidad de la mesa = comisiones cobradas − gastos pagados. Úsala para "¿cuál es la utilidad?", "¿cuánto hemos ganado?".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'top_deudores_acreedores',
      description: 'Lista de los mayores deudores y acreedores. Úsala para "¿quién debe más?", "top deudores", "¿a quién le debemos más?".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'utilidad_periodo',
      description: 'Utilidad (comisiones − gastos) de un día o un mes. Úsala para "utilidad de junio", "utilidad del 8 de junio", "¿cuánto ganamos ayer?". Pasa dia para un día específico; sin parámetros usa el mes más reciente.',
      parameters: {
        type: 'object',
        properties: {
          anio: { type: 'integer', description: 'año, ej. 2026' },
          mes: { type: 'integer', description: 'mes 1-12' },
          dia: { type: 'integer', description: 'día del mes 1-31 (solo si se pide un día específico)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estado_conciliacion',
      description: 'Resumen de conciliación de BINANCE CH: cuántos movimientos están conciliados, el porcentaje y el detalle de reconciliaciones. Úsala para "¿cómo va la conciliación?", "detalle de conciliación".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_duplicados',
      description: 'Busca posibles movimientos duplicados (misma fecha, cliente, cuenta, dirección y monto). Úsala para "¿hay duplicados?", "busca movimientos repetidos".',
      parameters: { type: 'object', properties: {} },
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
    return {
      cliente: d.name,
      saldo_usd: d.balance,
      rol: d.balance < 0 ? 'deudor (debe a KW2)' : d.balance > 0 ? 'acreedor (KW2 le debe)' : 'en cero',
      total_movimientos: d.movimientos.length,
      total_entradas_usd: Math.round(entradas * 100) / 100,
      total_salidas_usd: Math.round(salidas * 100) / 100,
    };
  }
  if (name === 'que_falta_conciliar') return await unreconciledBinance();
  if (name === 'zelles_sin_identificar') return await unidentifiedZelle();
  if (name === 'utilidad_mesa') return await utilidadMesa();
  if (name === 'top_deudores_acreedores') return await topBalances(10);
  if (name === 'utilidad_periodo') return await utilidadPeriodo(args?.anio ? Number(args.anio) : undefined, args?.mes ? Number(args.mes) : undefined, args?.dia ? Number(args.dia) : undefined);
  if (name === 'estado_conciliacion') return await estadoConciliacion();
  if (name === 'buscar_duplicados') return await buscarDuplicados(30);
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

// --- Modo razonamiento (DeepSeek-R1) ---
// Junta los datos de posibles problemas y pide a un modelo de razonamiento que
// los analice, distinguiendo errores reales de casos normales. No usa tools:
// la data se pre-consulta de forma determinista y se le entrega.
const REASONING_MODEL = process.env.KW2_REASONING_MODEL ?? 'deepseek-r1:8b';

const REASONING_SYSTEM = `Eres un auditor financiero de la mesa de cambio KW2. Te doy datos ya consultados (posibles duplicados, conciliaciones que no cuadran, estado de conciliación). Analiza con cuidado y distingue POSIBLES ERRORES REALES de casos normales (ej.: un cliente puede tener varios pagos idénticos legítimos el mismo día; un pago de nómina dividido genera montos iguales; un fee de Binance Pay es 0,01 aparte). Responde en español, conciso, con una lista priorizada de qué conviene revisar y por qué. NO inventes datos fuera de los provistos.`;

export async function askReasoning(question: string): Promise<{ answer: string; context: unknown }> {
  const [dups, estado, review] = await Promise.all([buscarDuplicados(40), estadoConciliacion(), needsReview()]);
  const context = { posibles_duplicados: dups, estado_conciliacion: estado, conciliaciones_que_no_cuadran: review };

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: REASONING_MODEL,
      messages: [
        { role: 'system', content: REASONING_SYSTEM },
        { role: 'user', content: `Pregunta: ${question}\n\nDatos disponibles (JSON):\n${JSON.stringify(context)}` },
      ],
      stream: false,
      options: { temperature: 0.3 },
    }),
  });
  if (res.status === 404) throw new Error(`Falta el modelo de razonamiento. Descárgalo con: ollama pull ${REASONING_MODEL}`);
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}.`);
  const data = await res.json();
  return { answer: stripThink(data?.message?.content ?? ''), context };
}
