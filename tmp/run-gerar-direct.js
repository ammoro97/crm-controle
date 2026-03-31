const mod = require('../.next/server/app/api/integracoes/analise-ia/gerar/route.js');
const originalFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (String(url || '').includes('mock-n8n.local')) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
(async () => {
  const body = {
    webhook: { url: 'https://mock-n8n.local/hook', method: 'POST' },
    call: {
      id: '8fb52012-4b68-41df-8180-1a95f7869014',
      callId: '8fb52012-4b68-41df-8180-1a95f7869014',
      leadId: 'L-1774783111392',
      externalCallId: '8fb52012-4b68-41df-8180-1a95f7869014',
      sessionId: 'SESSION-1774825714799-hna6l2',
      contactName: 'Arthur',
      companyName: 'Vila Beauty',
      phone: '5514996456910',
      attendantName: 'Arthur',
      startedAt: '2026-03-30T07:48:49.000Z',
      endedAt: '2026-03-30T07:48:52.000Z',
      durationSeconds: 0,
      status: 'Nao atendida',
      finalizacao: 'Cliente sem interesse',
      subfinalizacao: '-',
      origem: 'api4com',
      ramal: 'meu-crm',
      recordingUrl: 'https://listener.api4com.com/files/listen/example.mp3'
    }
  };
  const req = new Request('http://localhost/api/integracoes/analise-ia/gerar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const res = await mod.routeModule.userland.POST(req);
  const text = await res.text();
  console.log('[SIMULACAO_GERAR] STATUS', res.status);
  console.log('[SIMULACAO_GERAR] BODY', text);
})();
