const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority';

// ============ CORS CONFIGURADO CORRETAMENTE ============
const corsOptions = {
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

console.log('🚀 Backend iniciando...');

// ============ MONGOOSE SCHEMAS ============

const clientSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  token: String,
  createdAt: String,
  lawyerId: String
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
    console.error('❌ Erro MongoDB:', err.message);
    console.log('⚠️  Backend funcionando SEM MongoDB - dados não serão persistidos');
  });

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    version: '5.0',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    cors: 'enabled'
  });
});

// ============ BUSCAR PROCESSO ============
app.post('/api/search-process', async (req, res) => {
  try {
    const { processNumber } = req.body;

    if (!processNumber) {
      return res.status(400).json({ error: 'Número do processo é obrigatório' });
    }

    console.log('📋 Buscando processo:', processNumber);

    const processData = await searchCNJProcess(processNumber);

    res.status(200).json(processData);
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar processo', details: error.message });
  }
});

// Buscar na CNJ (API Real Gratuita)
async function searchCNJProcess(numero) {
  try {
    // Montar URL da CNJ
    const segmento = numero[8];
    const tribunal = numero.substring(9, 11);
    
    const tribunalCNJ = {
      '07': '0100002', // TRT-1
      '08': '0100032', // TRT-2
      '26': '0100386', // TJ-SP
      '09': '0100110'  // TJ-MG
    }[tribunal] || '0100002';

    // Formatar para CNJ
    const originNum = numero.substring(0, 7);
    const yearNum = numero.substring(4, 8);
    const segmentNum = segmento;
    const courtNum = tribunal;
    const originBase = numero.substring(14, 18);

    // Montar URL da CNJ
    const cnj_url = `https://www.cnj.jus.br/programas-e-acoes/numeracao-unica/json/?numero=${originNum}${yearNum}${segmentNum}${courtNum}${originBase}`;

    console.log('🔍 Buscando CNJ:', cnj_url);

    const response = await axios.get(cnj_url, { timeout: 8000 });
    const cnj_data = response.data;

    console.log('✅ CNJ retornou:', JSON.stringify(cnj_data).substring(0, 200));

    // Processar dados da CNJ
    const tribunal_info = identifyTribunal(numero);
    const isTrabalhista = tribunal_info.segmento === 'Trabalhista';

    // Montar resposta com dados reais da CNJ
    const processData = {
      numero: numero,
      formatado: formatarNumeroProcesso(numero),
      tribunal: tribunal_info.tribunal.nome,
      tribunalCompleto: tribunal_info.tribunal.completo,
      segmento: tribunal_info.segmento,
      tipo: cnj_data.tipo || (isTrabalhista ? 'Ação Trabalhista' : 'Ação Civil'),
      plaintiff: cnj_data.autores ? cnj_data.autores[0] : 'Parte Ativa',
      defendant: cnj_data.reus ? cnj_data.reus[0] : 'Parte Passiva',
      status: cnj_data.status || 'Em Andamento',
      currentPhase: extractPhase(cnj_data),
      judge: cnj_data.juiz || 'A definir',
      summary: cnj_data.assunto || 'Consulte o portal do tribunal para mais detalhes',
      lastMovement: extractLastMovement(cnj_data),
      movements: extractMovements(cnj_data),
      nextSteps: generateNextSteps(cnj_data),
      nextDeadline: extractNextDeadline(cnj_data),
      nextDeadlineDescription: extractDeadlineDescription(cnj_data),
      processValue: cnj_data.valor_causa || 'Não informado',
      searchedAt: new Date().toISOString()
    };

    return processData;
  } catch (error) {
    console.error('❌ Erro ao buscar CNJ:', error.message);
    throw new Error(`Erro ao buscar processo na CNJ: ${error.message}`);
  }
}

// ============ FUNÇÕES AUXILIARES ============

function formatarNumeroProcesso(numero) {
  if (!numero || numero.length !== 20) return numero;
  return `${numero.substring(0, 7)}-${numero.substring(7, 9)}.${numero.substring(9, 13)}.${numero.substring(13, 14)}.${numero.substring(14, 16)}.${numero.substring(16, 20)}`;
}

function identifyTribunal(numero) {
  const tribunal_code = numero.substring(9, 11);
  const segmento_code = numero[8];

  const tribunals = {
    '07': { nome: 'TRT-1', completo: 'Tribunal Regional do Trabalho - 1ª Região (São Paulo)' },
    '08': { nome: 'TRT-2', completo: 'Tribunal Regional do Trabalho - 2ª Região (São Paulo)' },
    '26': { nome: 'TJ-SP', completo: 'Tribunal de Justiça do Estado de São Paulo' },
    '09': { nome: 'TJ-MG', completo: 'Tribunal de Justiça do Estado de Minas Gerais' }
  };

  const segmentos = {
    '1': 'Cível',
    '2': 'Penal',
    '3': 'Trabalhista',
    '4': 'Eleitoral',
    '5': 'Militar'
  };

  return {
    tribunal: tribunals[tribunal_code] || { nome: 'Tribunal Federal', completo: 'Tribunal Federal' },
    segmento: segmentos[segmento_code] || 'Cível'
  };
}

function extractPhase(cnj_data) {
  const status = cnj_data.status || '';
  if (status.includes('Sentença')) return 'Sentença';
  if (status.includes('Recurso')) return 'Recurso';
  if (status.includes('Execução')) return 'Execução';
  if (status.includes('Distribuição')) return 'Distribuição';
  return 'Em Andamento';
}

function extractLastMovement(cnj_data) {
  if (cnj_data.movimentacoes && cnj_data.movimentacoes.length > 0) {
    const lastMov = cnj_data.movimentacoes[0];
    return {
      titulo: lastMov.titulo || 'Última Movimentação',
      descricao: lastMov.descricao || '',
      data: lastMov.data || new Date().toLocaleDateString('pt-BR')
    };
  }
  return null;
}

function extractMovements(cnj_data) {
  if (cnj_data.movimentacoes && Array.isArray(cnj_data.movimentacoes)) {
    return cnj_data.movimentacoes.map(m => ({
      titulo: m.titulo || '',
      descricao: m.descricao || '',
      data: m.data || ''
    }));
  }
  return [];
}

function extractNextDeadline(cnj_data) {
  if (cnj_data.proximo_prazo) {
    return cnj_data.proximo_prazo;
  }
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  return futureDate.toISOString();
}

function extractDeadlineDescription(cnj_data) {
  return cnj_data.descricao_prazo || 'Prazo a definir';
}

function generateNextSteps(cnj_data) {
  const steps = [];
  
  if (cnj_data.status && cnj_data.status.includes('Distribuição')) {
    steps.push('Aguardando designação de magistrado');
    steps.push('Análise inicial da petição');
  }
  
  if (cnj_data.status && cnj_data.status.includes('Andamento')) {
    steps.push('Acompanhar as movimentações processuais');
    steps.push('Responder aos prazos estabelecidos');
  }

  if (steps.length === 0) {
    steps.push('Consulte o portal do tribunal para próximos passos');
  }

  return steps;
}

// ============ LISTEN ============
app.listen(PORT, () => {
  console.log(`✅ Backend rodando em porta ${PORT}`);
  console.log(`🌐 CORS habilitado para todas as origens`);
});
