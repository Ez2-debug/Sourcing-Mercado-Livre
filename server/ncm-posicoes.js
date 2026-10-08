'use strict';

/*
 * Dicionario de tipo de produto -> posicao da NCM (4 digitos, ou um prefixo
 * mais longo quando o tipo de produto ja define a subposicao).
 *
 * A descricao legal da NCM raramente usa a palavra do anuncio ("mangueira de
 * jardim" esta em "tubos e seus acessorios, de plastico"), entao a busca por
 * texto sozinha nao acha a posicao. Este dicionario cobre os tipos de produto
 * mais comuns em sourcing; dentro da posicao, o codigo de 8 digitos sai da
 * tabela oficial.
 *
 * E uma sugestao de ponto de partida, nao classificacao fiscal: o material e a
 * funcao do produto mudam a posicao, e quem classifica e o despachante.
 *
 * As expressoes sao testadas contra o comeco do nome, sem acento e em
 * minusculas, na ordem abaixo; as mais especificas vem antes.
 */

const POSICOES = [
  // Capa e suporte seguem o material e o uso, nao o produto que protegem:
  // fora a capinha de celular, ficam sem sugestao.
  [/capinha|capa (para|de) celular|capa (para|de) iphone/, ['3926']],
  [/^(kit \d+ )?(capa|suporte)\b/, []],
  // casa e jardim
  [/mangueira/, ['39173']],
  [/espelho/, ['7009']],
  [/cortina|persiana/, ['6303']],
  [/tapete|capacho|passadeira/, ['5703', '5705']],
  [/cobertor|manta\b/, ['6301']],
  [/edredom|travesseiro|almofadas?\b|colchao|colchonete/, ['9404']],
  [/lencol|fronha|jogo de cama|toalha/, ['6302']],
  [/torneira|registro|valvula/, ['8481']],
  [/garrafa termica|copo termico|squeeze termic/, ['9617']],
  [/potes? (de |hermeticos? )?(de )?vidro|copos? de vidro|tacas?\b|jarra de vidro/, ['7013']],
  [/talher|faqueiro|garfo|colher/, ['8215']],
  [/\bfacas?\b|cutelo/, ['8211']],
  [/panela|frigideira|assadeira|cacarola|forma de bolo/, ['7323', '7615']],
  [/utensilios?|potes?\b|organizador|caixa organizadora|cesto|cabide|lixeira|escorredor|saboneteira|mamadeira|chupeta/, ['3924']],
  [/rodizio|rodinha|dobradica|puxador|corredica|fechadura/, ['8302', '8301']],
  [/cadeirinha|cadeira|poltrona|banqueta|banco\b|sofa/, ['9401']],
  [/mesa|estante|prateleira|armario|guarda-roupa|rack|escrivaninha|comoda|berco|criado-mudo/, ['9403']],
  [/planta artificial|flor(es)? artificia|samambaia artificial/, ['6702']],
  [/lampada/, ['8539']],
  [/luminaria|lustre|plafon|refletor|abajur|fita led|luminaria pendente|pendente de teto|arandela|cordao de luz|fio (de )?fada|pisca|holofote|spot\b/, ['9405']],
  [/papel de parede/, ['4814']],
  [/fita adesiva|adesivo/, ['3919']],
  [/vela\b|velas\b/, ['3406']],
  [/guarda-chuva|sombrinha/, ['6601']],
  [/escova|pincel|vassoura|rodo\b|esfregao|mop\b/, ['9603']],
  [/balanca/, ['8423']],
  // eletrodomesticos
  [/chuveiro|ducha|cafeteira|sanduicheira|air ?fryer|fritadeira|secador|chapinha|prancha de cabelo|ferro de passar|aquecedor|torradeira|chaleira eletrica|forno eletrico|micro-?ondas/, ['8516']],
  [/liquidificador|mixer|batedeira|processador de alimentos|espremedor|moedor/, ['8509']],
  [/ventilador|exaustor|coifa|climatizador/, ['8414']],
  [/aspirador/, ['8508']],
  // eletronicos e telefonia
  [/fones? de ouvido|headset|headphone|caixa de som|microfone|alto-?falante|soundbar/, ['8518']],
  [/power ?bank/, ['850760']],
  [/bateria/, ['8507']],
  [/tomada|interruptor|plugue|adaptador de tomada|disjuntor/, ['8536']],
  [/carregador|fonte\b/, ['8504']],
  [/cabo\b|cabos\b|extensao eletrica|filtro de linha/, ['8544']],
  // Antes das regras gerais de relogio e de estojo: o relogio de parede nao e
  // relogio de pulso, a pulseira avulsa tem posicao propria, e a caneta que
  // vem "com estojo" continua sendo caneta.
  [/relogios? de (parede|mesa)|despertador/, ['9105']],
  [/^(kit \d+ )?pulseiras? .*(watch|relogio|amazfit|mi band)/, ['9113']],
  [/^(kit \d+ )?canetas?\b/, ['9608']],
  [/porta[- ]?joias?|estojo (de|para) joias?/, ['4202']],
  [/piercing|brincos?\b|bijuteria|\bcolar\b|gargantilha|tornozeleira/, ['7117']],
  // "celular" so conta abrindo o nome: suporte e capa "de celular" sao outra coisa.
  [/smartwatch|relogio inteligente|^(kit \d+ )?celular|smartphone|telefone|roteador|repetidor|radios? comunicador|walkie/, ['8517']],
  [/relogio/, ['9102']],
  [/cartao de memoria|pen ?drive|\bssd\b|\bhd externo/, ['8523']],
  [/mouse|teclado|notebook|tablet/, ['8471']],
  [/webcam|camera/, ['8525']],
  [/drone/, ['8806']],
  [/tela\b.*(lcd|display|touch)|display lcd|frontal/, ['8524']],
  [/impressora|cartucho|toner/, ['8443']],
  [/monitor|televisor|smart tv|\btv\b/, ['8528']],
  [/console|joystick|controle (para|de) (ps|xbox|videogame)|videogame/, ['9504']],
  // ferramentas e automotivo
  [/jogo de ferramentas|kit (de )?ferramentas|maleta de ferramentas/, ['8206']],
  [/chaves? (de )?(precisao|fenda|philips|allen|catraca|combinada)|kit chave|martelo/, ['8205', '8204']],
  [/alicate/, ['8203']],
  [/furadeira|parafusadeira|esmerilhadeira|lixadeira|serra (tico|circular|marmore)/, ['8467']],
  [/broca|serra copo/, ['8207']],
  [/trena|paquimetro/, ['9017']],
  [/pneu/, ['4011']],
  [/palheta|limpador de para-?brisa/, ['8512']],
  // brinquedos, bebe, esporte e lazer
  [/brinquedo|boneca|boneco|pelucia|quebra-cabeca|blocos de montar|carrinho de controle/, ['9503']],
  [/carrinho de bebe/, ['8715']],
  [/fralda|absorvente/, ['9619']],
  [/bicicleta/, ['8712']],
  [/capacete/, ['6506']],
  [/barraca/, ['6306']],
  [/piscina|halter|anilha|faixa elastica|corda de pular|\bbola\b|raquete (de )?(tenis|beach|badminton)/, ['9506']],
  // moda e acessorios
  [/mochila|bolsa|mala\b|carteira|necessaire|estojo|pochete/, ['4202']],
  [/oculos/, ['9004']],
  [/tenis|sapato|sandalia|chinelo|bota\b|sapatilha/, ['6404', '6402']],
  [/camiseta|regata/, ['6109']],
  [/meias?\b/, ['6115']],
  [/bone\b|chapeu|gorro/, ['6505']],
  [/coleira|guia para (cachorro|cao|pet)|peitoral/, ['4201']],
  // beleza, higiene e limpeza
  [/perfume|colonia/, ['3303']],
  [/shampoo|condicionador|mascara capilar/, ['3305']],
  [/maquiagem|batom|base liquida|rimel|creme|serum|protetor solar|hidratante/, ['3304']],
  [/sabonete/, ['3401']],
  [/sabao|detergente|lava roupas|amaciante/, ['3402']],
  [/papel higienico|papel toalha|guardanapo/, ['4818']],
  [/pente\b/, ['9615']],
  [/suplemento|whey|creatina/, ['2106']],
  // papelaria
  [/caneta|marca-?texto/, ['9608']],
  [/lapis/, ['9609']],
  [/caderno|agenda|fichario/, ['4820']],
  [/isqueiro/, ['9613']],
];

module.exports = { POSICOES };
