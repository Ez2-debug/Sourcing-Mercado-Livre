'use strict';

/*
 * Marcas conhecidas: fabricantes e marcas de grande circulacao no Brasil,
 * que nao podem ser importadas para revenda sem licenca do titular.
 *
 * Quase todo produto do catalogo tem o campo marca preenchido, e na maioria
 * das vezes e a marca propria de um vendedor. Por isso a triagem so barra as
 * marcas desta lista; as demais contam como "marca de vendedor", com o aviso
 * de cotar o equivalente sem marca. A lista nao e completa: e uma barreira
 * para os casos obvios, nao uma consulta ao INPI.
 */

const MARCAS_CONHECIDAS = [
  // eletronicos, telefonia e informatica
  'samsung', 'apple', 'motorola', 'xiaomi', 'redmi', 'poco', 'huawei', 'honor', 'realme', 'oppo', 'lg', 'sony', 'nokia',
  'asus', 'acer', 'dell', 'hp', 'lenovo', 'positivo', 'multilaser', 'multi', 'intelbras', 'tp-link', 'tp link', 'd-link',
  'baofeng', 'anker', 'soundcore', 'baseus', 'ugreen', 'qcy', 'jbl', 'harman', 'bose', 'philips', 'panasonic', 'tcl',
  'aoc', 'elgin', 'logitech', 'razer', 'redragon', 'hyperx', 'kingston', 'sandisk', 'seagate', 'western digital', 'wd',
  'canon', 'nikon', 'gopro', 'dji', 'garmin', 'amazfit', 'fitbit', 'haylou', 'edifier', 'pioneer', 'positron', 'epson',
  'brother', 'intel', 'amd', 'nvidia', 'microsoft', 'xbox', 'playstation', 'nintendo', 'google', 'amazon', 'kindle',
  // eletrodomesticos e casa
  'electrolux', 'brastemp', 'consul', 'mondial', 'britania', 'philco', 'arno', 'walita', 'oster', 'cadence', 'black+decker',
  'black decker', 'black & decker', 'midea', 'gree', 'fischer', 'suggar', 'esmaltec', 'atlas', 'mueller', 'tramontina',
  'brinox', 'rochedo', 'panelux', 'nadir', 'marinex', 'pyrex', 'tupperware', 'sanremo', 'plasutil', 'ou', 'lorenzetti',
  'fame', 'hydra', 'deca', 'docol', 'tigre', 'amanco', 'astra', 'metasul', 'karsten', 'buddemeyer', 'teka', 'dohler',
  'santista', 'ortobom', 'castor', 'mor', 'tok&stok', 'tok stok', 'madesa', 'avant', 'osram', 'taschibra', 'ourolux',
  // ferramentas e automotivo
  'bosch', 'makita', 'dewalt', 'stanley', 'vonder', 'tramontina master', 'wap', 'karcher', 'tekna', 'gedore', 'worker',
  'einhell', '3m', 'tigre', 'michelin', 'pirelli', 'goodyear', 'bridgestone', 'moura', 'heliar', 'ngk', 'mobil', 'shell',
  'castrol', 'lubrax', 'honda', 'yamaha', 'fiat', 'volkswagen', 'chevrolet', 'ford', 'toyota', 'hyundai', 'renault',
  // limpeza, higiene, beleza e saude
  'omo', 'ariel', 'ype', 'vanish', 'veja', 'downy', 'comfort', 'brilhante', 'neve', 'personal', 'familiar', 'scott',
  'bravir', 'bombril', 'scotch-brite', 'scotch brite', 'sbp', 'raid', 'glade', 'bom ar', 'natura', 'avon', 'o boticario',
  'boticario', 'loreal', "l'oreal", 'nivea', 'dove', 'pantene', 'seda', 'gillette', 'oral-b', 'oral b', 'colgate',
  'johnson', "johnson's", 'pampers', 'huggies', 'salon line', 'vult', 'ruby rose', 'maybelline', 'wella', 'taiff',
  'growth', 'max titanium', 'integralmedica', 'omron', 'g-tech',
  // moda, esporte, brinquedos e bebe
  'nike', 'adidas', 'puma', 'fila', 'olympikus', 'mizuno', 'asics', 'new balance', 'vans', 'converse', 'havaianas',
  'melissa', 'lacoste', 'reserva', 'hering', 'lupo', 'penalty', 'umbro', 'speedo', 'oakley', 'ray-ban', 'ray ban',
  'casio', 'technos', 'mondaine', 'orient', 'invicta', 'lego', 'mattel', 'barbie', 'hot wheels', 'hasbro', 'estrela',
  'disney', 'marvel', 'pokemon', 'fisher-price', 'fisher price', 'galzerano', 'burigotto', 'chicco', 'philips avent',
  'stanley', 'tramontina', 'coleman', 'nautika', 'intex', 'bestway', 'caloi', 'shimano',
  // pet e alimentos
  'pedigree', 'whiskas', 'royal canin', 'golden', 'premier', 'purina', 'nestle', 'nescafe', 'pilao', '3 coracoes',
];

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const CONHECIDAS = new Set(MARCAS_CONHECIDAS.map(norm));
const SEM_MARCA = /^(generic[ao]|sem marca|n\/?a|outros?|oem|importad[ao]|nao se aplica|unbranded|varias|diversas)?$/;

// 'sem_marca', 'conhecida' ou 'de_vendedor'.
function classificarMarca(marca) {
  const m = norm(marca);
  if (SEM_MARCA.test(m)) return 'sem_marca';
  if (CONHECIDAS.has(m)) return 'conhecida';
  // "Samsung Galaxy", "Philips Walita": a marca conhecida abre o campo.
  const primeira = m.split(/\s+/)[0];
  if (primeira.length > 2 && CONHECIDAS.has(primeira)) return 'conhecida';
  return 'de_vendedor';
}

module.exports = { classificarMarca };
