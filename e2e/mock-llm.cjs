// Minimal OpenAI-compatible mock used ONLY to test the app's AI wiring locally.
require('http').createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    const user = (j.messages || []).slice(-1)[0]?.content || '';
    let content;
    if (/You extract numbers/.test(j.messages?.[0]?.content || '')) content = JSON.stringify({ unit: 'crore', basis: 'consolidated', items: [{ item: 'revenue', periodEnd: '2024-03-31', periodType: 'year', rawValue: '16,200.00', value: 16200 }, { item: 'pat', periodEnd: '2024-03-31', periodType: 'year', rawValue: '99,999.00', value: 99999 }] });
    else { const ex = (user.match(/\[E:[^\]\s]+\]/) || ['[E:none]'])[0]; content = `CALC: ROE was reported in the metrics [M:roe:FY2024]. CLAIM: management statement ${ex}. Fake citation [E:invented123].`; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}).listen(4011, () => console.log('mock on 4011'));
