// Espelha a constante SIZES do index.html. Se a grade da página mudar,
// esta tabela precisa mudar junto.
export const GRADE = {
  "Camiseta Fundo Preto": ["PP", "P", "M", "G", "GG", "XG"],
  "Camiseta Fundo Laranja": ["PP", "P", "M", "G", "GG", "XG"],
  "Regata": ["PP", "P", "M", "G", "GG"],
  "Camiseta Infantil (Citrino)": ["2", "4", "6", "8", "10", "12", "14"],
};

const LIMITES = { nome: 80, nomeCostas: 30, whats: 20 };

const texto = (v) => (typeof v === "string" ? v.trim() : "");

export function validarPedido(corpo) {
  if (!corpo || typeof corpo !== "object") {
    return { ok: false, erro: "Corpo inválido." };
  }

  const nome = texto(corpo.nome);
  const modelo = texto(corpo.modelo);
  const tamanho = texto(corpo.tamanho);
  const nomeCostas = texto(corpo.nomeCostas);
  const whats = texto(corpo.whats);

  if (!nome || !modelo || !tamanho || !nomeCostas) {
    return { ok: false, erro: "Preencha todos os campos obrigatórios." };
  }
  if (nome.length > LIMITES.nome) {
    return { ok: false, erro: "Nome muito longo." };
  }
  if (nomeCostas.length > LIMITES.nomeCostas) {
    return { ok: false, erro: "Nome nas costas muito longo." };
  }
  if (whats.length > LIMITES.whats) {
    return { ok: false, erro: "WhatsApp inválido." };
  }

  if (!Object.hasOwn(GRADE, modelo)) {
    return { ok: false, erro: "Modelo inválido." };
  }
  const tamanhos = GRADE[modelo];
  if (!tamanhos.includes(tamanho)) {
    return { ok: false, erro: "Tamanho inválido para esse modelo." };
  }

  // Devolve só os campos permitidos: pago e criado_em são do servidor.
  return { ok: true, pedido: { nome, modelo, tamanho, nomeCostas, whats } };
}
