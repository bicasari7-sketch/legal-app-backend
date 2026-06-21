const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority';
const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

// ============ CORS ============
app.use(cors());
app.use(express.json());

console.log('🚀 Backend iniciando...');

// ============ SCHEMAS ============
const clientSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  token: String,
  createdAt: String
});

const processSchema = new mongoose.Schema({
  id: String,
  clientId: String,
  numero: String,
  formatado: String,
  tribunal: String,
  tribunalCompleto: String,
  segmento: String,
  tipo: String,
  plaintiff: String,
  defendant: String,
  status: String,
  currentPhase: String,
  judge: String,
  summary: String,
  lastMovement: Object,
  movements: Array,
  nextSteps: Array,
  nextDeadline: String,
  nextDeadlineDescription: String,
  processValue: String,
  advogadoNotes: String,
  searchedAt: String,
  createdAt: String
});

const Client = mongoose.model('Client', clientSchema);
const Process = mongoose.model('Process', processSchema);

// ============ CONECTAR MONGODB ============
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch((err) => {
    console.error('❌ MongoDB erro:', err.message);
  });

// ============ HEALTH ============
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '6.0',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ============ BUSCAR PROCESSO ============
app.post('/api/search-process', async (req, res) => {
  try {
    const { processNumber } = req.body;

    if (!processNumber) {
      return res.status(400).json({ error: 'Número do processo é obrigatório' });
    }

    console.log('📋 Buscando:', processNumber);

    const processData = await searchDataJud(processNumber);
    res.json(processData);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ BUSCAR NO DATAJUD ============
async function searchDataJud(numero) {
  const cleanNumber = numero.replace(/\D/g, '');

  if (cleanNumber.length !== 20) {
    throw new Error('Número do processo deve ter 20 dígitos');
  }

  const tribunal_info = identifyTribunal(cleanNumber);
  const sigla = tribunal_info.siglaApi;

  console.log(`🔍 DataJud: tribunal=${sigla} numero=${cleanNumber}`);

  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${sigla}/_search`;

  const response = await axios.post(
    url,
    {
      query: {
        match: { numeroProcesso: cleanNumber }
      }
    },
    {
      headers: {
        'Authorization': `APIKey ${DATAJUD_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  const hits = response.data?.hits?.hits || [];

  if (hits.length === 0) {
    throw new Error(`Processo ${formatarNumeroProcesso(cleanNumber)} não encontrado no DataJud`);
  }

  // Pode haver múltiplos hits (G1 e G2). Ordenar: G2 primeiro se existir.
  const grauOrder = { 'TR': 0, 'G2': 1, 'GR': 2, 'G1': 3, 'JE': 4 };
  hits.sort((a, b) => (grauOrder[a._source.grau] ?? 99) - (grauOrder[b._source.grau] ?? 99));

  const hit = hits[0]._source;

  console.log('✅ DataJud OK | grau:', hit.grau);
  console.log('📦 Partes raw:', JSON.stringify(hit.partes));

  // O polo pode vir como 'AT'/'PA' ou 'ATIVO'/'PASSIVO' dependendo do tribunal
  const polosAtivo   = ['AT', 'ATIVO', 'Ativo', 'ativo', 'at'];
  const polosPassivo = ['PA', 'PASSIVO', 'Passivo', 'passivo', 'pa', 'RE', 'REU', 'Réu'];

  const partes = hit.partes || [];
  const partesAtivas   = partes.filter(p => polosAtivo.includes(p.polo));
  const partesPassivas = partes.filter(p => polosPassivo.includes(p.polo));

  const plaintiff = partesAtivas.map(p => p.nome).filter(Boolean).join(', ') || 'Não informado';
  const defendant = partesPassivas.map(p => p.nome).filter(Boolean).join(', ') || 'Não informado';

  const grauLabel = resolveGrau(hit.grau);
  const emRecurso = ['G2', 'GR', 'TR', 'SUP'].includes(hit.grau);

  const movimentos = (hit.movimentos || []).map(m => {
    // complementosTabelados: { descricao = nome do campo, valor = valor real }
    const complemento = m.complementosTabelados?.map(c => c.nome).filter(Boolean).join(' | ')
      || m.complementosLivres?.map(c => c.descricao).filter(Boolean).join(' | ')
      || '';
    return {
      titulo: m.nome || 'Movimentação',
      descricao: complemento,
      data: m.dataHora ? new Date(m.dataHora).toLocaleDateString('pt-BR') : ''
    };
  });

  const ultimoMovimento = movimentos.length > 0 ? movimentos[0] : null;

  return {
    numero: cleanNumber,
    formatado: formatarNumeroProcesso(cleanNumber),
    tribunal: tribunal_info.tribunal.nome,
    tribunalCompleto: tribunal_info.tribunal.completo,
    segmento: tribunal_info.segmento,
    tipo: hit.classeProcessual?.nome || 'Ação Judicial',
    plaintiff,
    defendant,
    status: hit.nivelSigilo === 0 ? 'Público' : 'Sigiloso',
    currentPhase: hit.fase?.nome || 'Em Andamento',
    grau: grauLabel,
    emRecurso,
    judge: hit.orgaoJulgador?.nome || 'Não informado',
    summary: hit.assuntos?.[0]?.nome || 'Sem assunto informado',
    lastMovement: ultimoMovimento,
    movements: movimentos,
    nextSteps: generateNextSteps(hit),
    nextDeadline: null,
    nextDeadlineDescription: 'Consulte o portal do tribunal',
    processValue: hit.valorCausa ? `R$ ${Number(hit.valorCausa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Não informado',
    searchedAt: new Date().toISOString()
  };
}

function resolveGrau(grau) {
  const map = {
    'G1':  'Primeiro Grau',
    'G2':  'Segundo Grau (Recurso)',
    'GR':  'Grau Recursal',
    'JE':  'Juizado Especial',
    'TR':  'Turma Recursal (Recurso)',
    'SUP': 'Tribunal Superior'
  };
  return map[grau] || grau || 'Não informado';
}

// ============ FUNÇÕES AUXILIARES ============

function formatarNumeroProcesso(numero) {
  const n = numero.replace(/\D/g, '');
  if (n.length !== 20) return numero;
  return `${n.substring(0,7)}-${n.substring(7,9)}.${n.substring(9,13)}.${n.substring(13,14)}.${n.substring(14,16)}.${n.substring(16,20)}`;
}

function identifyTribunal(cleanNumber) {
  // Formato CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO
  // posição 13 = segmento (J), posição 14-15 = tribunal (TT)
  const segmentoCode = cleanNumber[13];
  const tribunalCode = cleanNumber.substring(14, 16);

  const segmentos = {
    '1': 'STF',
    '2': 'CNJ',
    '3': 'STJ',
    '4': 'Justiça Federal',
    '5': 'Trabalhista',
    '6': 'Eleitoral',
    '7': 'Militar da União',
    '8': 'Estadual/DF',
    '9': 'Militar Estadual'
  };

  // Segmento 8 = Estadual
  const tribunaisEstaduais = {
    '01': { nome: 'TJAC', completo: 'Tribunal de Justiça do Acre',                siglaApi: 'tjac' },
    '02': { nome: 'TJAL', completo: 'Tribunal de Justiça de Alagoas',             siglaApi: 'tjal' },
    '03': { nome: 'TJAP', completo: 'Tribunal de Justiça do Amapá',               siglaApi: 'tjap' },
    '04': { nome: 'TJAM', completo: 'Tribunal de Justiça do Amazonas',            siglaApi: 'tjam' },
    '05': { nome: 'TJBA', completo: 'Tribunal de Justiça da Bahia',               siglaApi: 'tjba' },
    '06': { nome: 'TJCE', completo: 'Tribunal de Justiça do Ceará',               siglaApi: 'tjce' },
    '07': { nome: 'TJDF', completo: 'Tribunal de Justiça do Distrito Federal',    siglaApi: 'tjdft' },
    '08': { nome: 'TJES', completo: 'Tribunal de Justiça do Espírito Santo',      siglaApi: 'tjes' },
    '09': { nome: 'TJGO', completo: 'Tribunal de Justiça de Goiás',               siglaApi: 'tjgo' },
    '10': { nome: 'TJMA', completo: 'Tribunal de Justiça do Maranhão',            siglaApi: 'tjma' },
    '11': { nome: 'TJMT', completo: 'Tribunal de Justiça do Mato Grosso',         siglaApi: 'tjmt' },
    '12': { nome: 'TJMS', completo: 'Tribunal de Justiça do Mato Grosso do Sul',  siglaApi: 'tjms' },
    '13': { nome: 'TJMG', completo: 'Tribunal de Justiça de Minas Gerais',        siglaApi: 'tjmg' },
    '14': { nome: 'TJPA', completo: 'Tribunal de Justiça do Pará',                siglaApi: 'tjpa' },
    '15': { nome: 'TJPB', completo: 'Tribunal de Justiça da Paraíba',             siglaApi: 'tjpb' },
    '16': { nome: 'TJPR', completo: 'Tribunal de Justiça do Paraná',              siglaApi: 'tjpr' },
    '17': { nome: 'TJPE', completo: 'Tribunal de Justiça de Pernambuco',          siglaApi: 'tjpe' },
    '18': { nome: 'TJPI', completo: 'Tribunal de Justiça do Piauí',               siglaApi: 'tjpi' },
    '19': { nome: 'TJRJ', completo: 'Tribunal de Justiça do Rio de Janeiro',      siglaApi: 'tjrj' },
    '20': { nome: 'TJRN', completo: 'Tribunal de Justiça do Rio Grande do Norte', siglaApi: 'tjrn' },
    '21': { nome: 'TJRS', completo: 'Tribunal de Justiça do Rio Grande do Sul',   siglaApi: 'tjrs' },
    '22': { nome: 'TJRO', completo: 'Tribunal de Justiça de Rondônia',            siglaApi: 'tjro' },
    '23': { nome: 'TJRR', completo: 'Tribunal de Justiça de Roraima',             siglaApi: 'tjrr' },
    '24': { nome: 'TJSC', completo: 'Tribunal de Justiça de Santa Catarina',      siglaApi: 'tjsc' },
    '25': { nome: 'TJSE', completo: 'Tribunal de Justiça de Sergipe',             siglaApi: 'tjse' },
    '26': { nome: 'TJSP', completo: 'Tribunal de Justiça de São Paulo',           siglaApi: 'tjsp' },
    '27': { nome: 'TJTO', completo: 'Tribunal de Justiça do Tocantins',           siglaApi: 'tjto' }
  };

  // Segmento 5 = Trabalhista (TRTs)
  const tribunaisTrabalho = {
    '01': { nome: 'TRT-1',  completo: 'TRT da 1ª Região (RJ)',   siglaApi: 'trt1'  },
    '02': { nome: 'TRT-2',  completo: 'TRT da 2ª Região (SP)',   siglaApi: 'trt2'  },
    '03': { nome: 'TRT-3',  completo: 'TRT da 3ª Região (MG)',   siglaApi: 'trt3'  },
    '04': { nome: 'TRT-4',  completo: 'TRT da 4ª Região (RS)',   siglaApi: 'trt4'  },
    '05': { nome: 'TRT-5',  completo: 'TRT da 5ª Região (BA)',   siglaApi: 'trt5'  },
    '06': { nome: 'TRT-6',  completo: 'TRT da 6ª Região (PE)',   siglaApi: 'trt6'  },
    '07': { nome: 'TRT-7',  completo: 'TRT da 7ª Região (CE)',   siglaApi: 'trt7'  },
    '08': { nome: 'TRT-8',  completo: 'TRT da 8ª Região (PA/AP)',siglaApi: 'trt8'  },
    '09': { nome: 'TRT-9',  completo: 'TRT da 9ª Região (PR)',   siglaApi: 'trt9'  },
    '10': { nome: 'TRT-10', completo: 'TRT da 10ª Região (DF/TO)',siglaApi: 'trt10' },
    '11': { nome: 'TRT-11', completo: 'TRT da 11ª Região (AM/RR)',siglaApi: 'trt11' },
    '12': { nome: 'TRT-12', completo: 'TRT da 12ª Região (SC)',  siglaApi: 'trt12' },
    '13': { nome: 'TRT-13', completo: 'TRT da 13ª Região (PB)',  siglaApi: 'trt13' },
    '14': { nome: 'TRT-14', completo: 'TRT da 14ª Região (RO/AC)',siglaApi: 'trt14' },
    '15': { nome: 'TRT-15', completo: 'TRT da 15ª Região (Campinas)',siglaApi: 'trt15'},
    '16': { nome: 'TRT-16', completo: 'TRT da 16ª Região (MA)', siglaApi: 'trt16' },
    '17': { nome: 'TRT-17', completo: 'TRT da 17ª Região (ES)', siglaApi: 'trt17' },
    '18': { nome: 'TRT-18', completo: 'TRT da 18ª Região (GO)', siglaApi: 'trt18' },
    '19': { nome: 'TRT-19', completo: 'TRT da 19ª Região (AL)', siglaApi: 'trt19' },
    '20': { nome: 'TRT-20', completo: 'TRT da 20ª Região (SE)', siglaApi: 'trt20' },
    '21': { nome: 'TRT-21', completo: 'TRT da 21ª Região (RN)', siglaApi: 'trt21' },
    '22': { nome: 'TRT-22', completo: 'TRT da 22ª Região (PI)', siglaApi: 'trt22' },
    '23': { nome: 'TRT-23', completo: 'TRT da 23ª Região (MT)', siglaApi: 'trt23' },
    '24': { nome: 'TRT-24', completo: 'TRT da 24ª Região (MS)', siglaApi: 'trt24' }
  };

  // Segmento 4 = Federal (TRFs)
  const tribunaisFederais = {
    '01': { nome: 'TRF-1', completo: 'Tribunal Regional Federal da 1ª Região', siglaApi: 'trf1' },
    '02': { nome: 'TRF-2', completo: 'Tribunal Regional Federal da 2ª Região', siglaApi: 'trf2' },
    '03': { nome: 'TRF-3', completo: 'Tribunal Regional Federal da 3ª Região', siglaApi: 'trf3' },
    '04': { nome: 'TRF-4', completo: 'Tribunal Regional Federal da 4ª Região', siglaApi: 'trf4' },
    '05': { nome: 'TRF-5', completo: 'Tribunal Regional Federal da 5ª Região', siglaApi: 'trf5' },
    '06': { nome: 'TRF-6', completo: 'Tribunal Regional Federal da 6ª Região', siglaApi: 'trf6' }
  };

  // Segmento 3 = STJ
  const stj = { nome: 'STJ', completo: 'Superior Tribunal de Justiça', siglaApi: 'stj' };

  // Segmento 1 = STF
  const stf = { nome: 'STF', completo: 'Supremo Tribunal Federal', siglaApi: 'stf' };

  // Segmento 6 = Eleitoral (TREs)
  const tribunaisEleitorais = {
    '01': { nome: 'TRE-AC', completo: 'Tribunal Regional Eleitoral do Acre',                siglaApi: 'treac' },
    '02': { nome: 'TRE-AL', completo: 'Tribunal Regional Eleitoral de Alagoas',             siglaApi: 'treal' },
    '03': { nome: 'TRE-AP', completo: 'Tribunal Regional Eleitoral do Amapá',               siglaApi: 'treap' },
    '04': { nome: 'TRE-AM', completo: 'Tribunal Regional Eleitoral do Amazonas',            siglaApi: 'tream' },
    '05': { nome: 'TRE-BA', completo: 'Tribunal Regional Eleitoral da Bahia',               siglaApi: 'treba' },
    '06': { nome: 'TRE-CE', completo: 'Tribunal Regional Eleitoral do Ceará',               siglaApi: 'trece' },
    '07': { nome: 'TRE-DF', completo: 'Tribunal Regional Eleitoral do Distrito Federal',    siglaApi: 'tredf' },
    '08': { nome: 'TRE-ES', completo: 'Tribunal Regional Eleitoral do Espírito Santo',      siglaApi: 'trees' },
    '09': { nome: 'TRE-GO', completo: 'Tribunal Regional Eleitoral de Goiás',               siglaApi: 'trego' },
    '10': { nome: 'TRE-MA', completo: 'Tribunal Regional Eleitoral do Maranhão',            siglaApi: 'trema' },
    '11': { nome: 'TRE-MT', completo: 'Tribunal Regional Eleitoral do Mato Grosso',         siglaApi: 'tremt' },
    '12': { nome: 'TRE-MS', completo: 'Tribunal Regional Eleitoral do Mato Grosso do Sul',  siglaApi: 'trems' },
    '13': { nome: 'TRE-MG', completo: 'Tribunal Regional Eleitoral de Minas Gerais',        siglaApi: 'tremg' },
    '14': { nome: 'TRE-PA', completo: 'Tribunal Regional Eleitoral do Pará',                siglaApi: 'trepa' },
    '15': { nome: 'TRE-PB', completo: 'Tribunal Regional Eleitoral da Paraíba',             siglaApi: 'trepb' },
    '16': { nome: 'TRE-PR', completo: 'Tribunal Regional Eleitoral do Paraná',              siglaApi: 'trepr' },
    '17': { nome: 'TRE-PE', completo: 'Tribunal Regional Eleitoral de Pernambuco',          siglaApi: 'trepe' },
    '18': { nome: 'TRE-PI', completo: 'Tribunal Regional Eleitoral do Piauí',               siglaApi: 'trepi' },
    '19': { nome: 'TRE-RJ', completo: 'Tribunal Regional Eleitoral do Rio de Janeiro',      siglaApi: 'trerj' },
    '20': { nome: 'TRE-RN', completo: 'Tribunal Regional Eleitoral do Rio Grande do Norte', siglaApi: 'trern' },
    '21': { nome: 'TRE-RS', completo: 'Tribunal Regional Eleitoral do Rio Grande do Sul',   siglaApi: 'trers' },
    '22': { nome: 'TRE-RO', completo: 'Tribunal Regional Eleitoral de Rondônia',            siglaApi: 'trero' },
    '23': { nome: 'TRE-RR', completo: 'Tribunal Regional Eleitoral de Roraima',             siglaApi: 'trerr' },
    '24': { nome: 'TRE-SC', completo: 'Tribunal Regional Eleitoral de Santa Catarina',      siglaApi: 'tresc' },
    '25': { nome: 'TRE-SE', completo: 'Tribunal Regional Eleitoral de Sergipe',             siglaApi: 'trese' },
    '26': { nome: 'TRE-SP', completo: 'Tribunal Regional Eleitoral de São Paulo',           siglaApi: 'tresp' },
    '27': { nome: 'TRE-TO', completo: 'Tribunal Regional Eleitoral do Tocantins',           siglaApi: 'treto' }
  };

  let tribunal = null;
  let segmento = segmentos[segmentoCode] || 'Não identificado';

  if (segmentoCode === '8') {
    tribunal = tribunaisEstaduais[tribunalCode];
    segmento = 'Estadual';
  } else if (segmentoCode === '5') {
    tribunal = tribunaisTrabalho[tribunalCode];
    segmento = 'Trabalhista';
  } else if (segmentoCode === '4') {
    tribunal = tribunaisFederais[tribunalCode];
    segmento = 'Federal';
  } else if (segmentoCode === '3') {
    tribunal = stj;
    segmento = 'Superior';
  } else if (segmentoCode === '1') {
    tribunal = stf;
    segmento = 'Superior';
  } else if (segmentoCode === '6') {
    tribunal = tribunaisEleitorais[tribunalCode];
    segmento = 'Eleitoral';
  }

  if (!tribunal) {
    tribunal = { nome: 'Tribunal', completo: 'Tribunal não identificado', siglaApi: 'tjsp' };
  }

  return { tribunal, segmento, siglaApi: tribunal.siglaApi };
}

function generateNextSteps(hit) {
  const steps = [];
  const fase = hit.fase?.nome?.toLowerCase() || '';
  const classe = hit.classeProcessual?.nome?.toLowerCase() || '';

  if (fase.includes('conhecimento') || fase.includes('inicial')) {
    steps.push('Aguardar citação/intimação da parte contrária');
    steps.push('Acompanhar designação de audiência');
  } else if (fase.includes('recurso')) {
    steps.push('Acompanhar julgamento do recurso');
    steps.push('Verificar prazos para contrarrazões');
  } else if (fase.includes('execução')) {
    steps.push('Acompanhar cumprimento de sentença');
    steps.push('Verificar penhora e avaliação de bens');
  } else {
    steps.push('Acompanhar movimentações no portal do tribunal');
    steps.push('Consulte seu advogado sobre os próximos prazos');
  }

  return steps;
}

// ============ DEBUG — remover depois ============
app.post('/api/debug-process', async (req, res) => {
  try {
    const { processNumber } = req.body;
    const cleanNumber = processNumber.replace(/\D/g, '');
    const tribunal_info = identifyTribunal(cleanNumber);
    const sigla = tribunal_info.siglaApi;

    const response = await axios.post(
      `https://api-publica.datajud.cnj.jus.br/api_publica_${sigla}/_search`,
      { query: { match: { numeroProcesso: cleanNumber } } },
      {
        headers: {
          'Authorization': `APIKey ${DATAJUD_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const hits = response.data?.hits?.hits || [];
    // Retorna o _source bruto de todos os hits para inspeção
    res.json(hits.map(h => ({
      grau: h._source.grau,
      partes: h._source.partes,
      movimentos: h._source.movimentos?.slice(0, 3)
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ LISTEN ============
app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`);
});
