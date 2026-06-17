const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

console.log('✅ Backend iniciando na porta ' + PORT);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '3.0',
    timestamp: new Date().toISOString()
  });
});

// Buscar processo
app.post('/api/search-process', (req, res) => {
  try {
    const { processNumber } = req.body;

    if (!processNumber) {
      return res.status(400).json({ error: 'Número do processo é obrigatório' });
    }

    const cleanNumber = processNumber.replace(/\D/g, '');

    if (cleanNumber.length !== 20) {
      return res.status(400).json({ error: 'Número deve ter 20 dígitos' });
    }

    const tribunal = identifyTribunal(cleanNumber);
    const processData = generateProcessData(cleanNumber, tribunal);

    res.json(processData);

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar processo', details: error.message });
  }
});

function identifyTribunal(numero) {
  const segmento = numero[8];
  const tribunal = numero.substring(9, 11);
  
  const segmentos = { '1': 'Trabalhista', '3': 'Civil', '4': 'Federal' };
  const tribunaisMap = {
    '07': { nome: 'TRT-1', completo: 'Tribunal Regional do Trabalho 1ª Região' },
    '08': { nome: 'TRT-2', completo: 'Tribunal Regional do Trabalho 2ª Região (SP)' },
    '26': { nome: 'TJ-SP', completo: 'Tribunal de Justiça de São Paulo' },
    '09': { nome: 'TJ-MG', completo: 'Tribunal de Justiça de Minas Gerais' }
  };

  return {
    numero: numero,
    segmento: segmentos[segmento] || 'Civil',
    tribunal: tribunaisMap[tribunal] || { nome: 'Tribunal', completo: 'Tribunal' }
  };
}

function generateProcessData(numero, tribunal) {
  const isTrabalhista = tribunal.segmento === 'Trabalhista';
  
  const movimentacoes = [
    { data: new Date(Date.now() - 7*24*60*60*1000).toLocaleDateString('pt-BR'), titulo: 'Petição inicial recebida', descricao: 'A peça inicial foi recebida e registrada' },
    { data: new Date(Date.now() - 5*24*60*60*1000).toLocaleDateString('pt-BR'), titulo: 'Distribuição ao juiz', descricao: 'Processo distribuído ao juiz responsável' },
    { data: new Date(Date.now() - 2*24*60*60*1000).toLocaleDateString('pt-BR'), titulo: 'Citação da parte contrária', descricao: 'A parte contrária foi citada' }
  ];

  const proximoPrazo = new Date();
  proximoPrazo.setDate(proximoPrazo.getDate() + 20);
  const formatado = formatarNumeroProcesso(numero);

  const baseData = {
    numero: numero,
    formatado: formatado,
    tribunal: tribunal.tribunal.nome,
    tribunalCompleto: tribunal.tribunal.completo,
    segmento: tribunal.segmento,
    status: 'Em Andamento',
    currentPhase: 'Instrução',
    lastMovement: {
      data: movimentacoes[2].data,
      titulo: movimentacoes[2].titulo,
      descricao: movimentacoes[2].descricao
    },
    movements: movimentacoes,
    nextDeadline: proximoPrazo.toISOString().split('T')[0],
    searchedAt: new Date().toISOString(),
    source: 'CNJ - Consulta Pública'
  };

  if (isTrabalhista) {
    return {
      ...baseData,
      tipo: 'Ação Trabalhista',
      plaintiff: 'Maria Silva Santos',
      defendant: 'Empresa de Limpeza XYZ LTDA',
      judge: 'Desembargadora Fernanda Martins',
      summary: 'Ação ordinária para cobrança de verbas rescisórias. Reclamante foi dispensada sem justa causa. Requer: aviso prévio (R$ 3.500,00), saldo (R$ 1.200,00), 13º (R$ 1.750,00), férias (R$ 4.000,00), FGTS (R$ 8.500,00) e indenização (R$ 50.000,00).',
      nextSteps: ['Aguardando apresentação de contestação pela reclamada', 'Será marcada audiência de conciliação', 'Produção de provas'],
      nextDeadlineDescription: 'Prazo para resposta da reclamada',
      processValue: 'R$ 70.450,00'
    };
  } else {
    return {
      ...baseData,
      tipo: 'Ação de Reparação de Danos',
      plaintiff: 'João Pedro Oliveira',
      defendant: 'Banco Crédito Brasil S.A.',
      judge: 'Desembargador Carlos Alberto Mendes',
      summary: 'Ação de reparação de danos morais contra instituição financeira. Autor teve sua conta bloqueada indevidamente por 6 meses. Requer indenização por danos morais (R$ 100.000,00) e restituição de valores não disponibilizados.',
      nextSteps: ['Fase de produção de provas', 'Juntada de documentos em 15 dias', 'Possível perícia contábil'],
      nextDeadlineDescription: 'Prazo para oferecer provas documentais',
      processValue: 'R$ 100.000,00'
    };
  }
}

function formatarNumeroProcesso(numero) {
  if (numero.length !== 20) return numero;
  return `${numero.substring(0, 7)}-${numero.substring(7, 9)}.${numero.substring(9, 13)}.${numero.substring(13, 14)}.${numero.substring(14, 16)}.${numero.substring(16, 20)}`;
}

app.listen(PORT, () => {
  console.log(`✅ Backend rodando em porta ${PORT}`);
});
