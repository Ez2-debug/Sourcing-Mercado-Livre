// Categorias amplas para filtrar listas de fontes diferentes (Mercado Livre,
// Shopee, JoomPro, aduana, Compras Paraguai), que usam arvores proprias.
// Primeiro olha a categoria que a fonte deu; sem ela, o titulo.

const REGRAS = [
  ['Moda e calçados', /\b(calcad|roupa|moda|tenis|sapat|sandalia|chinelo|bolsa|mochila|vestido|blusa|camis|calca|short|bermuda|jaqueta|casaco|pijama|kigurumi|meia|cueca|sutia|lingerie|intima|oculos|relogio|joia|bijuteria|brinco|colar|pulseira|anel|presilha|cabelo acessor|bone|cinto|fantasia|macac|body)/],
  ['Beleza e perfumes', /\b(beleza|perfume|maquiagem|batom|corretivo|base liquida|serum|cosmetic|cilios|esmalte|unha|manicure|pedicure|depila|barbead|shampoo|xampu|capilar|cuidados com a pele|cuidados com o cabelo|creme|protetor solar|colonia|toucador|tocador)/],
  ['Celulares e eletrônicos', /\b(celular|smartphone|iphone|galaxy|telefon|fone|headset|audio|caixa de som|alto.falante|som |eletronic|tv\b|televis|smartwatch|smart watch|camera|drone|carregador|cabo usb|powerbank|streaming|echo|alexa|kindle|tablet|ipad|microfone|projetor|monitor)/],
  ['Informática e games', /\b(informatica|notebook|computador|pc\b|mouse|teclado|impressora|ssd|hd\b|memoria|game|games|videogame|console|playstation|xbox|nintendo|switch|controle|joystick|maquinas automaticas para processamento)/],
  ['Casa e cozinha', /\b(casa|cozinha|decora|cama|colchao|travesseiro|almofada|cobertor|toalha|tapete|cortina|banheiro|organiza|pote|panela|talher|utensil|iluminacao|luminaria|lampada|limpeza|lavanderia|moveis|movel|jardim|festa|natal|enfeite)/],
  ['Eletrodomésticos', /\b(eletrodomestic|ar.condicionado|split|ventilador|geladeira|refrigerador|congelador|lavar roupa|lava.loucas|maquina de lavar|micro.ondas|forno|fogao|aspirador|robo de limpeza|air ?fryer|fritadeira|liquidificador|cafeteira|aquecedor|batedeira)/],
  ['Brinquedos e bebês', /\b(brinquedo|boneca|boneco|pelucia|squishy|fidget|jogo de tabuleiro|lego|bebe|bebes|infantil|chupeta|mamadeira|carrinho de bebe|fralda|mae e bebe)/],
  ['Esportes e lazer', /\b(esporte|fitness|academia|bicicleta|ciclismo|bike|camping|pesca|carretilha|molinete|vara de pesca|varas|natacao|futebol|bola|corrida|yoga|musculacao|suplementos e shakers|patins|skate)/],
  ['Saúde e suplementos', /\b(saude|suplemento|vitamina|multivitamin|creatina|whey|proteina|colageno|massage|ortoped|termometro|medidor|farmacia)/],
  ['Ferramentas e construção', /\b(ferrament|furadeira|parafusadeira|chave|alicate|martelo|multimetro|serra|solda|construcao|eletrica|interruptor|tomada|fita adesiva|trena)/],
  ['Veículos e motos', /\b(veiculo|automotiv|carro|moto|motocicleta|capacete|pneu|dashcam|automovel|caminhonete|retrovisor)/],
  ['Papelaria e escritório', /\b(papelaria|armarinho|escolar|caderno|caneta|lapis|pince|tinta|artesanato|silicone|cola |etiqueta)/],
  ['Alimentos e bebidas', /\b(alimento|bebida|mercearia|azeite|cafe|cha |chocolate|doce|tempero|vinho|cerveja)/],
  ['Pet', /\b(pet|cachorro|caes|cao|gato|gatos|racao|coleira|aquario)/],
];

const tira = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const CATEGORIAS = REGRAS.map(([nome]) => nome).concat('Outros');

export function categoriaAmpla(categoria, titulo) {
  for (const texto of [categoria, titulo]) {
    const t = ` ${tira(texto)} `;
    if (!t.trim()) continue;
    const achou = REGRAS.find(([, re]) => re.test(t));
    if (achou) return achou[0];
  }
  return 'Outros';
}
