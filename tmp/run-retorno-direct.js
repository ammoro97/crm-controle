const mod = require('../.next/server/app/api/integracoes/analise-ia/retorno/route.js');
(async () => {
  const body = {
    event: 'call.analysis.completed',
    requestId: 'ANL-DIRECT-RETORNO-001',
    status: 'done',
    call: {
      callId: '8fb52012-4b68-41df-8180-1a95f7869014',
      phone: '14996456910'
    },
    phone: '14996456910',
    analysisText: 'Teste direto do endpoint de retorno para captura completa dos logs.'
  };

  const req = new Request('http://localhost/api/integracoes/analise-ia/retorno', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const res = await mod.routeModule.userland.POST(req);
  const text = await res.text();
  console.log('[SIMULACAO_RETORNO] STATUS', res.status);
  console.log('[SIMULACAO_RETORNO] BODY', text);
})();
