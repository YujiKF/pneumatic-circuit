import { generate } from './src/pipeline.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORT = 5173;

const HTML_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PMR3407 — Gerador de Circuitos Eletropneumáticos</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --success: #16a34a;
      --danger: #dc2626;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      background: #0f172a;
      color: white;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #3b82f6;
    }
    header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      background: #1e293b;
      color: #93c5fd;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      border: 1px solid #334155;
    }
    .nav-links a {
      color: #93c5fd;
      text-decoration: none;
      font-size: 13px;
      margin-left: 16px;
      padding: 6px 12px;
      border: 1px solid #334155;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .nav-links a:hover {
      background: #1e293b;
      color: white;
    }
    main {
      max-width: 1280px;
      margin: 24px auto;
      padding: 0 20px;
    }
    .control-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .presets-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }
    .presets-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
    }
    .preset-btn {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #334155;
      padding: 4px 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .preset-btn:hover {
      background: #e2e8f0;
      color: #0f172a;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr auto;
      gap: 16px;
      align-items: flex-end;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    input[type="text"], select {
      height: 40px;
      padding: 8px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 14px;
      background: white;
      color: var(--text);
    }
    input[type="text"]:focus, select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
    }
    .btn-submit {
      height: 40px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 0 24px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-submit:hover {
      background: var(--primary-hover);
    }
    .status-banner {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 14px;
    }
    .status-banner.success {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
    }
    .status-banner.error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 2px solid var(--border);
      padding-bottom: 2px;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -4px;
      transition: all 0.2s;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .diagram-container {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      overflow: auto;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      margin-bottom: 24px;
    }
    .diagram-container svg {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    th, td {
      border: 1px solid var(--border);
      padding: 10px 14px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 600;
    }
    .explanation-card {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px 24px;
    }
    .explanation-card ol {
      margin: 0;
      padding-left: 20px;
    }
    .explanation-card li {
      margin-bottom: 10px;
      font-size: 14px;
      line-height: 1.6;
    }
    .download-bar {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-bottom: 12px;
    }
    .btn-download {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 4px;
      cursor: pointer;
      color: #334155;
      text-decoration: none;
    }
    .btn-download:hover {
      background: #e2e8f0;
    }
    .validation-card {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px 24px;
    }
    .check-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 16px;
    }
    .check-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 14px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .check-icon {
      font-size: 16px;
      line-height: 1.2;
    }
    .check-icon.pass { color: #16a34a; }
    .check-icon.fail { color: #dc2626; }
    .check-title { font-weight: 600; font-size: 13px; color: #1e293b; display: flex; align-items: center; justify-content: space-between; }
    .check-code { font-family: monospace; font-size: 10px; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; color: #475569; }
    .check-desc { font-size: 12px; color: #64748b; margin-top: 2px; }
  </style>
</head>
<body>
  <header>
    <h1>
      <span>⚡</span> PMR3407 — Sistemas Fluido-Mecânicos
      <span class="badge">Passo a Passo Eletropneumático</span>
    </h1>
    <div class="nav-links">
      <a href="/golden_preview.html" target="_blank">📋 Ver Golden Tests (5 Casos)</a>
    </div>
  </header>

  <main>
    <div class="control-card">
      <div class="presets-bar">
        <span class="presets-label">Testes Prontos:</span>
        <button class="preset-btn" onclick="applyPreset('A+B+A-B-')">A+B+A-B-</button>
        <button class="preset-btn" onclick="applyPreset('A+B+B-A-')">A+B+B-A-</button>
        <button class="preset-btn" onclick="applyPreset('A+B+C+A-B-C-')">A+B+C+A-B-C-</button>
        <button class="preset-btn" onclick="applyPreset('B-C+A+B+C-A-')">B-C+A+B+C-A-</button>
        <button class="preset-btn" onclick="applyPreset('A-B+B-B+B-TA+')">A-B+B-B+B-TA+</button>
      </div>

      <form id="circuit-form" onsubmit="handleGenerate(event)">
        <div class="form-grid">
          <div class="form-group">
            <label for="sequence-input">Sequência de Movimentos</label>
            <input type="text" id="sequence-input" value="A+B+A-B-" required placeholder="Ex: A+B+A-B-">
          </div>
          <div class="form-group">
            <label for="type-select">Tecnologia</label>
            <select id="type-select">
              <option value="electropneumatic" selected>Eletropneumático</option>
              <option value="pneumatic">Pneumático</option>
            </select>
          </div>
          <div class="form-group">
            <label for="method-select">Método</label>
            <select id="method-select">
              <option value="step-by-step" selected>Passo a Passo</option>
              <option value="cascade">Cascata</option>
            </select>
          </div>
          <div class="form-group">
            <label for="mode-select">Ciclo</label>
            <select id="mode-select">
              <option value="single" selected>Ciclo Único</option>
              <option value="continuous">Ciclo Contínuo</option>
            </select>
          </div>
          <button type="submit" class="btn-submit" id="submit-btn">Gerar Circuito</button>
        </div>
      </form>
    </div>

    <div id="status-area"></div>

    <div id="results-area" style="display: none;">
      <div class="tabs">
        <button class="tab-btn active" onclick="showTab('pneumatic')">Circuito Pneumático</button>
        <button class="tab-btn" onclick="showTab('ladder')">Ladder Elétrico (+24V / 0V)</button>
        <button class="tab-btn" onclick="showTab('steps')">Tabela de Etapas</button>
        <button class="tab-btn" onclick="showTab('explanation')">Funcionamento Cronológico</button>
        <button class="tab-btn" onclick="showTab('validation')">Resultado da Validação</button>
      </div>

      <div id="tab-pneumatic" class="tab-content active">
        <div class="download-bar">
          <button class="btn-download" onclick="downloadSvg('pneumatic-svg-wrapper', 'circuito_pneumatico.svg')">Salvar SVG</button>
        </div>
        <div class="diagram-container" id="pneumatic-svg-wrapper"></div>
      </div>

      <div id="tab-ladder" class="tab-content">
        <div class="download-bar">
          <button class="btn-download" onclick="downloadSvg('ladder-svg-wrapper', 'ladder_eletrico.svg')">Salvar SVG</button>
        </div>
        <div class="diagram-container" id="ladder-svg-wrapper"></div>
      </div>

      <div id="tab-steps" class="tab-content">
        <div id="steps-wrapper"></div>
      </div>

      <div id="tab-explanation" class="tab-content">
        <div class="explanation-card">
          <ol id="explanation-list"></ol>
        </div>
      </div>

      <div id="tab-validation" class="tab-content">
        <div class="validation-card" id="validation-wrapper"></div>
      </div>
    </div>
  </main>

  <script>
    function applyPreset(seq) {
      document.getElementById('sequence-input').value = seq;
      document.getElementById('type-select').value = 'electropneumatic';
      document.getElementById('method-select').value = 'step-by-step';
      document.getElementById('mode-select').value = 'single';
      document.getElementById('circuit-form').dispatchEvent(new Event('submit'));
    }

    function showTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      const targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => {
        const text = btn.textContent.toLowerCase();
        if (tabName === 'pneumatic') return text.includes('pneumático');
        if (tabName === 'ladder') return text.includes('ladder');
        if (tabName === 'steps') return text.includes('etapas');
        if (tabName === 'explanation') return text.includes('cronológico');
        if (tabName === 'validation') return text.includes('validação');
        return false;
      });
      if (targetBtn) targetBtn.classList.add('active');
      
      const targetContent = document.getElementById('tab-' + tabName);
      if (targetContent) targetContent.classList.add('active');
    }

    async function handleGenerate(event) {
      event.preventDefault();
      const submitBtn = document.getElementById('submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Gerando...';

      const reqData = {
        sequence: document.getElementById('sequence-input').value.trim(),
        type: document.getElementById('type-select').value,
        method: document.getElementById('method-select').value,
        mode: document.getElementById('mode-select').value,
      };

      try {
        const resp = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqData),
        });
        const result = await resp.json();

        const statusArea = document.getElementById('status-area');
        const resultsArea = document.getElementById('results-area');

        if (!result.ok) {
          statusArea.innerHTML = \`<div class="status-banner error"><strong>Erro de Validação:</strong> \${result.error}</div>\`;
          resultsArea.style.display = 'none';
        } else {
          statusArea.innerHTML = \`
            <div class="status-banner success">
              <span><strong>✓ Circuito Válido:</strong> Sequência \${reqData.sequence} sintetizada e verificada sem conflitos.</span>
              <span style="font-size: 12px; color: #15803d;">Normas PMR3407 / DIN ISO 5599</span>
            </div>
          \`;
          
          document.getElementById('pneumatic-svg-wrapper').innerHTML = result.pneumaticSvg || '<p>Diagrama pneumático não disponível.</p>';
          document.getElementById('ladder-svg-wrapper').innerHTML = result.ladderSvg || '<p>Diagrama ladder não aplicável.</p>';

          // Tabela de Etapas
          let tableHtml = \`
            <table>
              <thead>
                <tr>
                  <th>Etapa (Relé)</th>
                  <th>Movimento</th>
                  <th>Solenoide</th>
                  <th>Sensor de Chegada</th>
                  <th>Disparo</th>
                  <th>Temporizador</th>
                </tr>
              </thead>
              <tbody>
          \`;
          (result.steps || []).forEach(s => {
            tableHtml += \`
              <tr>
                <td><strong>\${s.relayId}</strong></td>
                <td>\${s.movement}</td>
                <td><code>\${s.solenoidId}</code></td>
                <td><code>\${s.arrivalSensorId}</code></td>
                <td>\${s.enabledBy}</td>
                <td>\${s.hasTimer ? 'Sim' : 'Não'}</td>
              </tr>
            \`;
          });
          tableHtml += '</tbody></table>';
          document.getElementById('steps-wrapper').innerHTML = tableHtml;

          // Explicação cronológica
          const expList = document.getElementById('explanation-list');
          expList.innerHTML = (result.funcionamento || []).map(item => \`<li>\${item}</li>\`).join('');

          // Resultado da Validação
          const verif = result.verification || { ok: true, issues: [] };
          const checks = [
            { code: 'VAL_NONEXISTENT_COMPONENT', title: 'Componentes Existentes', desc: 'Conexões referenciam apenas componentes válidos.' },
            { code: 'VAL_NONEXISTENT_PORT', title: 'Portas Válidas', desc: 'Portas de conexão (1, 2, 3, 4, 5, 12, 14, in, out) compatíveis com o tipo.' },
            { code: 'VAL_REQUIRED_PORT_UNCONNECTED', title: 'Conexões Obrigatórias', desc: 'Nenhuma porta essencial do circuito deixada em aberto.' },
            { code: 'VAL_DUPLICATE_COMPONENT', title: 'Unicidade de Identificadores', desc: 'Nenhum componente ou identificador duplicado.' },
            { code: 'VAL_NONEXISTENT_SENSOR', title: 'Sensores de Fim de Curso', desc: 'Sensores mecânicos/magnéticos (1S1, 1S2...) declarados.' },
            { code: 'VAL_NONEXISTENT_RELAY', title: 'Relés de Memória', desc: 'Relés de passo (K1..Kn) definidos na topologia.' },
            { code: 'VAL_NONEXISTENT_SOLENOID', title: 'Solenoides de Comando', desc: 'Bobinas de válvula (1Y1, 1Y2...) consistentes com os atuadores.' },
            { code: 'VAL_COIL_WITHOUT_COMPONENT', title: 'Associação de Bobinas', desc: 'Bobinas associadas a válvulas ou relés físicos reais.' },
            { code: 'VAL_IMPOSSIBLE_TRANSITION', title: 'Consistência Cinemática', desc: 'Sem avanços simultâneos antagônicos ou transições impossíveis.' },
            { code: 'VAL_STEP_WITHOUT_EXIT', title: 'Continuidade de Ciclo', desc: 'Toda etapa possui condição de saída definida.' },
            { code: 'VAL_UNREACHABLE_STEP', title: 'Acessibilidade de Etapas', desc: 'Todas as etapas da sequência são ativadas na ordem correta.' },
            { code: 'VAL_LOGICAL_CONFLICT', title: 'Integridade do Selo e Lógica', desc: 'Contato de selo sustentando a memória até o reset pelo passo seguinte.' }
          ];

          let verifHtml = \`
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
              <div>
                <h3 style="margin: 0; font-size: 16px; color: \${verif.ok ? '#166534' : '#991b1b'};">
                  \${verif.ok ? '✓ Circuito Totalmente Validado' : '✗ Violações Encontradas'}
                </h3>
                <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--text-muted);">
                  \${verif.ok ? 'O circuito atende integralmente a todas as 12 regras formais e à metodologia canônica da PMR3407.' : 'Foram detectadas falhas estruturais ou lógicas que impedem a operação segura.'}
                </p>
              </div>
              <span class="badge" style="background: \${verif.ok ? '#dcfce7' : '#fee2e2'}; color: \${verif.ok ? '#166534' : '#991b1b'}; border-color: \${verif.ok ? '#86efac' : '#fca5a5'}; font-size: 13px; padding: 6px 12px;">
                \${verif.issues.length} problema(s) encontrado(s)
              </span>
            </div>
            <div class="check-grid">
          \`;

          checks.forEach(c => {
            const hasIssue = (verif.issues || []).some(iss => iss.code === c.code);
            verifHtml += \`
              <div class="check-item" style="border-left: 4px solid \${hasIssue ? '#dc2626' : '#16a34a'};">
                <span class="check-icon \${hasIssue ? 'fail' : 'pass'}">\${hasIssue ? '✗' : '✓'}</span>
                <div style="flex: 1;">
                  <div class="check-title">
                    <span>\${c.title}</span>
                    <span class="check-code">\${c.code}</span>
                  </div>
                  <div class="check-desc">\${c.desc}</div>
                </div>
              </div>
            \`;
          });

          verifHtml += \`</div>\`;

          if (verif.issues && verif.issues.length > 0) {
            verifHtml += \`
              <div style="margin-top: 20px;">
                <h4 style="color: #991b1b; margin-bottom: 8px;">Detalhes das Falhas Detectadas:</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Elemento Afetado</th>
                      <th>Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
            \`;
            verif.issues.forEach(iss => {
              verifHtml += \`
                <tr>
                  <td><code>\${iss.code}</code></td>
                  <td>\${iss.subject || '-'}</td>
                  <td>\${iss.message}</td>
                </tr>
              \`;
            });
            verifHtml += \`</tbody></table></div>\`;
          }

          document.getElementById('validation-wrapper').innerHTML = verifHtml;

          resultsArea.style.display = 'block';
        }
      } catch (err) {
        document.getElementById('status-area').innerHTML = \`<div class="status-banner error">Falha na requisição: \${err.message}</div>\`;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Gerar Circuito';
      }
    }

    function downloadSvg(wrapperId, filename) {
      const container = document.getElementById(wrapperId);
      const svg = container.querySelector('svg');
      if (!svg) return;
      const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    // Auto-executa a sequência padrão no carregamento
    window.addEventListener('DOMContentLoaded', () => {
      document.getElementById('circuit-form').dispatchEvent(new Event('submit'));
    });
  </script>
</body>
</html>
`;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML_PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/golden_preview.html') {
      const filePath = path.resolve('golden_preview.html');
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return new Response(content, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('golden_preview.html not found', { status: 404 });
    }

    if (url.pathname === '/api/generate' && req.method === 'POST') {
      try {
        const body = await req.json();
        const result = generate({
          sequence: body.sequence,
          type: body.type || 'electropneumatic',
          method: body.method || 'step-by-step',
          mode: body.mode || 'single',
        });
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          headers: { 'Content-Type': 'application/json' },
          status: 400,
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${PORT}`);
