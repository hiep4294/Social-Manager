const GROUPS = [
  {
    key: 'kho_rim', category: 'Kho / Rim', prefix: false,
    mains: ['thịt ba chỉ','sườn non','nạc vai heo','chân giò','thịt băm','thăn bò','bắp bò','gân bò','ức gà','đùi gà','cánh gà','gà ta','vịt','cá lóc','cá basa','cá thu','cá nục','cá diêu hồng','cá trắm','cá hồi','tôm','mực','bạch tuộc','trứng','đậu hũ','nấm đùi gà','nấm hương','cà tím','củ cải trắng','măng tươi'],
    styles: [
      ['kho tiêu','tiêu đen, hành tím, nước mắm'],
      ['kho gừng','gừng, hành tím, nước mắm'],
      ['kho sả ớt','sả, ớt, nước mắm'],
      ['rim nước mắm','tỏi, nước mắm, đường'],
      ['rim nước dừa','nước dừa, hành tím, nước mắm']
    ]
  },
  {
    key: 'xao', category: 'Món xào', prefix: false,
    mains: ['thịt bò','thịt heo','thịt gà','vịt','tôm','mực','bạch tuộc','nghêu','sò điệp','cá hồi','cá basa','đậu hũ','nấm đùi gà','nấm hương','nấm kim châm','rau muống','cải thìa','bông cải xanh','bông cải trắng','đậu cô ve','măng tây','cà tím','bí ngòi','su su','mướp','giá đỗ','ngô non','củ sen','cà rốt','khoai tây'],
    styles: [
      ['xào tỏi','tỏi, dầu hào, tiêu'],
      ['xào sả ớt','sả, ớt, nước mắm'],
      ['xào sa tế','sa tế, tỏi, hành'],
      ['xào nấm','nấm tươi, hành, dầu hào'],
      ['xào chua ngọt','cà chua, hành tây, giấm, đường']
    ]
  },
  {
    key: 'nuong', category: 'Món nướng', prefix: false,
    mains: ['ba chỉ heo','sườn non','nạc vai heo','thăn bò','bò cuộn','ức gà','đùi gà','cánh gà','gà ta','vịt','cá lóc','cá basa','cá thu','cá hồi','tôm','mực','bạch tuộc','sò điệp','hàu','đậu hũ','nấm đùi gà','cà tím','ngô ngọt','khoai tây','bí đỏ'],
    styles: [
      ['nướng muối ớt','muối, ớt, tỏi, dầu ăn'],
      ['nướng sả','sả, tỏi, nước mắm'],
      ['nướng mật ong','mật ong, nước tương, tỏi'],
      ['nướng sa tế','sa tế, tỏi, dầu hào'],
      ['nướng tiêu xanh','tiêu xanh, hành tím, dầu hào']
    ]
  },
  {
    key: 'chien', category: 'Chiên / Áp chảo', prefix: false,
    mains: ['cánh gà','đùi gà','ức gà','sườn non','thịt ba chỉ','thăn heo','thăn bò','cá lóc','cá basa','cá thu','cá diêu hồng','cá hồi','tôm','mực','bạch tuộc','hàu','trứng','đậu hũ','nấm đùi gà','cà tím','khoai tây','khoai lang','bí đỏ','ngô non','chả cá'],
    styles: [
      ['chiên giòn','bột chiên giòn, muối, tiêu'],
      ['chiên nước mắm','nước mắm, tỏi, đường'],
      ['chiên sả','sả băm, tỏi, nước mắm'],
      ['chiên xù','bột mì, trứng, bột chiên xù'],
      ['áp chảo bơ tỏi','bơ, tỏi, tiêu']
    ]
  },
  {
    key: 'hap', category: 'Món hấp', prefix: false,
    mains: ['gà ta','đùi gà','ức gà','vịt','sườn non','bò cuộn','cá lóc','cá basa','cá thu','cá diêu hồng','cá hồi','tôm','mực','bạch tuộc','nghêu','sò điệp','hàu','cua','ghẹ','chả cá'],
    styles: [
      ['hấp gừng hành','gừng, hành lá, nước tương'],
      ['hấp sả','sả, lá chanh, muối'],
      ['hấp xì dầu','nước tương, gừng, hành'],
      ['hấp nấm','nấm hương, hành, tiêu'],
      ['hấp bia','bia, sả, gừng']
    ]
  },
  {
    key: 'canh', category: 'Canh / Súp / Cháo', prefix: true,
    mains: ['gà','bò','sườn non','thịt băm','cá lóc','cá hồi','tôm','cua','nghêu','hải sản','nấm','đậu hũ','bí đỏ','khoai tây','bắp ngọt','rong biển','cải thảo','trứng','chả cá','viên thả lẩu'],
    styles: [
      ['Canh chua','me, cà chua, dứa, rau thơm'],
      ['Canh thanh','gừng, hành, rau xanh'],
      ['Súp','nước dùng, bắp, nấm, bột năng'],
      ['Cháo','gạo, gừng, hành lá, tiêu'],
      ['Canh nấm','nấm tươi, hành, gừng']
    ]
  },
  {
    key: 'com_bun_mi', category: 'Cơm / Bún / Mì', prefix: true,
    mains: ['bò','gà','heo','vịt','tôm','mực','hải sản','cá hồi','cá basa','chả cá','trứng','đậu hũ','nấm','rau củ','cải thìa','bông cải','kim chi','xúc xích','thịt băm','sườn'],
    styles: [
      ['Cơm rang','cơm nguội, trứng, hành lá'],
      ['Cơm trộn','cơm nóng, rau, sốt trộn'],
      ['Bún xào','bún, rau cải, hành'],
      ['Mì xào','mì, rau cải, dầu hào'],
      ['Miến xào','miến, nấm, hành']
    ]
  },
  {
    key: 'chay_rau', category: 'Chay / Rau củ', prefix: false,
    mains: ['đậu hũ','đậu hũ non','nấm đùi gà','nấm hương','nấm kim châm','nấm bào ngư','cà tím','bí đỏ','bí ngòi','bông cải xanh','bông cải trắng','cải thìa','rau muống','đậu cô ve','măng tây','củ sen','cà rốt','khoai tây','khoai lang','măng tươi'],
    styles: [
      ['xào tỏi chay','tỏi, dầu thực vật, nước tương'],
      ['kho tiêu chay','tiêu, nước tương, hành boa-rô'],
      ['sốt nấm chay','nấm, nước tương, dầu mè'],
      ['áp chảo mè','dầu thực vật, mè, muối, tiêu'],
      ['hấp gừng chay','gừng, hành boa-rô, nước tương']
    ]
  },
  {
    key: 'an_vat', category: 'Ăn vặt', prefix: false,
    mains: ['khoai tây','khoai lang','khoai môn','ngô ngọt','bánh tráng','bánh gạo','bánh mì que','xúc xích','chả cá viên','đậu hũ'],
    styles: [
      ['chiên giòn','bột chiên, muối, dầu ăn'],
      ['lắc phô mai','bột phô mai, bơ, muối'],
      ['nướng bơ','bơ, tỏi, tiêu'],
      ['sốt cay','tương ớt, tỏi, đường'],
      ['mật ong','mật ong, bơ, mè rang']
    ]
  }
];

const INTRO = [
  'Gợi ý món hôm nay: {title}. Nguyên liệu quen thuộc, cách làm rõ ràng và phù hợp bữa ăn tại nhà.',
  '{title} là một lựa chọn dễ đưa vào thực đơn hằng ngày. Làm đúng vài bước chính là món lên vị rất ổn.',
  'Đổi vị với {title}: công thức tập trung vào phần nêm, nhiệt và thời gian để món dễ thành công.',
  'Nếu đang chưa biết ăn gì, thử {title}. Công thức dưới đây được viết ngắn gọn để dễ lưu và làm lại.'
];

const CATEGORY_TAGS = {
  'Kho / Rim': ['#MonKho','#ComNha'],
  'Món xào': ['#MonXao','#MonNgonDeLam'],
  'Món nướng': ['#MonNuong','#CuoiTuanAnGi'],
  'Chiên / Áp chảo': ['#MonChien','#BepNha'],
  'Món hấp': ['#MonHap','#AnNgonMoiNgay'],
  'Canh / Súp / Cháo': ['#MonNuoc','#BuaComGiaDinh'],
  'Cơm / Bún / Mì': ['#ComBunMi','#HomNayAnGi'],
  'Chay / Rau củ': ['#MonChay','#RauCuNgon'],
  'Ăn vặt': ['#AnVat','#MonNgonCuoiTuan']
};

let CACHE = null;

function titleCaseFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function slugId(n) {
  return `FOOD-${String(n).padStart(4, '0')}`;
}

function commonIngredients(main, seasoning) {
  return [
    `500g ${main}`,
    seasoning,
    '2 củ hành tím hoặc 3 tép tỏi',
    '1 muỗng canh dầu ăn',
    'muối, đường và tiêu vừa đủ'
  ];
}

function stepsFor(group, main, style) {
  const styleName = style[0].toLowerCase();
  if (group.key === 'kho_rim') return [
    `Sơ chế ${main}, cắt miếng vừa ăn và để thật ráo.`,
    `Ướp với phần gia vị chính của kiểu ${styleName} trong 15-20 phút.`,
    `Làm nóng nồi, cho ${main} vào đảo săn rồi thêm lượng nước vừa đủ.`,
    'Hạ nhỏ lửa, nấu đến khi chín mềm và phần sốt sánh bám quanh nguyên liệu.',
    'Nêm lại lần cuối, thêm hành hoặc tiêu rồi tắt bếp.'
  ];
  if (group.key === 'xao') return [
    `Sơ chế ${main}, cắt kích thước đồng đều và để ráo.`,
    `Chuẩn bị phần gia vị cho kiểu ${styleName}.`,
    `Làm nóng chảo ở lửa lớn, xào ${main} nhanh đến khoảng 70-80% độ chín.`,
    'Thêm phần sốt/gia vị, đảo nhanh để bám đều mà không ra quá nhiều nước.',
    'Nêm lại, tắt bếp khi nguyên liệu vừa chín tới.'
  ];
  if (group.key === 'nuong') return [
    `Sơ chế ${main}, thấm khô bề mặt.`,
    `Ướp với gia vị ${styleName} tối thiểu 30 phút.`,
    'Làm nóng lò, nồi chiên hoặc bếp nướng trước khi cho nguyên liệu vào.',
    'Nướng đến khi bề mặt vàng thơm, lật giữa chừng để chín đều.',
    'Quét lớp sốt mỏng ở cuối, nghỉ 3-5 phút trước khi dùng.'
  ];
  if (group.key === 'chien') return [
    `Sơ chế ${main}, thấm thật khô để hạn chế bắn dầu.`,
    `Chuẩn bị lớp gia vị hoặc phần áo cho kiểu ${styleName}.`,
    'Làm nóng chảo, cho lượng dầu phù hợp và kiểm tra nhiệt trước khi chiên.',
    `Chiên/áp chảo ${main} đến khi bề mặt vàng, phần bên trong vừa chín.`,
    'Để ráo dầu hoặc đảo nhanh với sốt, dùng khi còn nóng.'
  ];
  if (group.key === 'hap') return [
    `Sơ chế ${main} sạch, để ráo và khứa/cắt vừa ăn nếu cần.`,
    `Xếp phần gia vị ${styleName} ở đáy và trên mặt nguyên liệu.`,
    'Đun nước hấp sôi trước rồi mới đặt món vào xửng.',
    `Hấp đến khi ${main} vừa chín, tránh kéo dài làm món khô hoặc dai.`,
    'Rưới phần nước sốt còn lại, thêm hành/gừng rồi dùng nóng.'
  ];
  if (group.key === 'canh') return [
    `Sơ chế ${main}; chuẩn bị nước dùng và các nguyên liệu phụ.`,
    'Đun nước dùng sôi nhẹ, hớt bọt để phần nước trong hơn.',
    `Cho ${main} vào theo thứ tự chín lâu trước, chín nhanh sau.`,
    `Hoàn thiện theo kiểu ${style[0].toLowerCase()}, nêm vị cân bằng.`,
    'Thêm rau thơm/hành ở cuối và dùng khi còn nóng.'
  ];
  if (group.key === 'com_bun_mi') return [
    `Sơ chế ${main}; chuẩn bị phần tinh bột và rau ăn kèm.`,
    `Ướp hoặc nêm ${main} nhẹ trước khi chế biến.`,
    `Làm nóng chảo, chế biến ${main} trước rồi để riêng.`,
    `Cho phần ${style[0].toLowerCase()} vào chảo, đảo ở lửa vừa-lớn để không bị nát.`,
    'Trộn nguyên liệu trở lại, nêm vừa ăn và dùng nóng.'
  ];
  if (group.key === 'chay_rau') return [
    `Sơ chế ${main}, cắt đều để chín cùng thời điểm.`,
    `Chuẩn bị phần gia vị cho kiểu ${styleName}.`,
    `Làm nóng chảo hoặc xửng, chế biến ${main} ở nhiệt vừa.`,
    'Nêm nước tương và gia vị vừa đủ, hạn chế nấu quá lâu.',
    'Hoàn thiện với tiêu, mè hoặc hành boa-rô.'
  ];
  return [
    `Chuẩn bị ${main} và các gia vị đi kèm.`,
    `Sơ chế để nguyên liệu khô ráo trước khi làm kiểu ${styleName}.`,
    'Chế biến ở nhiệt phù hợp đến khi bề mặt thơm và chín đều.',
    'Trộn/lắc với phần sốt hoặc gia vị khi món còn nóng.',
    'Dùng ngay để giữ độ giòn và hương vị tốt nhất.'
  ];
}

function tipFor(group) {
  const tips = {
    kho_rim: 'Kho/rim ở lửa nhỏ sau khi sôi giúp gia vị thấm đều và hạn chế cạn sốt quá nhanh.',
    xao: 'Chảo đủ nóng và chia nguyên liệu thành mẻ nhỏ giúp món xào không bị ra nhiều nước.',
    nuong: 'Thấm khô bề mặt và chỉ quét sốt ngọt ở cuối giúp món vàng thơm mà ít cháy.',
    chien: 'Bề mặt nguyên liệu càng khô thì món càng dễ vàng giòn và ít bắn dầu.',
    hap: 'Chỉ bắt đầu tính thời gian hấp khi nước đã sôi ổn định để món chín đều.',
    canh: 'Cho rau thơm và gia vị mùi ở cuối để nước dùng giữ mùi tươi.',
    com_bun_mi: 'Tinh bột chỉ nên làm vừa chín trước khi xào để thành phẩm không bết.',
    chay_rau: 'Rau củ nên chín tới để giữ độ giòn, màu và vị ngọt tự nhiên.',
    an_vat: 'Làm từng mẻ nhỏ giúp nhiệt ổn định và món giữ kết cấu tốt hơn.'
  };
  return tips[group.key];
}

function buildContent(item, index) {
  const intro = INTRO[index % INTRO.length].replace('{title}', item.title);
  const ingredients = item.ingredients.map(x => `- ${x}`).join('\n');
  const steps = item.steps.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const tags = ['#MonNgonMoiNgay','#BepNha','#CongThucNauAn', ...(CATEGORY_TAGS[item.category] || [])];
  return `${intro}\n\nNGUYÊN LIỆU\n${ingredients}\n\nCÁCH LÀM\n${steps}\n\nMẸO NHỎ\n${item.tip}\n\n${tags.join(' ')}`;
}

export function buildFoodLibrary() {
  if (CACHE) return CACHE;
  const out = [];
  let n = 0;
  for (const group of GROUPS) {
    for (const main of group.mains) {
      for (const style of group.styles) {
        n += 1;
        const rawTitle = group.key === 'an_vat' ? `${main} ${style[0]} ăn vặt` : (group.prefix ? `${style[0]} ${main}` : `${main} ${style[0]}`);
        const title = titleCaseFirst(rawTitle);
        const item = {
          id: slugId(n),
          title,
          category: group.category,
          group: group.key,
          main,
          style: style[0],
          ingredients: commonIngredients(main, style[1]),
          steps: stepsFor(group, main, style),
          tip: tipFor(group),
          image_url: `/food-images/food-${String(n).padStart(4, '0')}.webp`,
          image_prompt: `Ảnh món ${title}, food photography chân thực, trình bày hấp dẫn, ánh sáng tự nhiên, góc chụp 45 độ, món ăn Việt Nam hoặc phong cách bếp gia đình Việt, chi tiết rõ, không người, không logo, khung vuông 1:1.`
        };
        item.content = buildContent(item, n - 1);
        out.push(item);
      }
    }
  }
  if (out.length !== 1000) throw new Error(`Food library phải có đúng 1000 món, hiện có ${out.length}`);
  if (new Set(out.map(x => x.title.toLowerCase())).size !== out.length) throw new Error('Food library có tên món trùng');
  CACHE = Object.freeze(out.map(x => Object.freeze(x)));
  return CACHE;
}

export function foodCategories() {
  return [...new Set(buildFoodLibrary().map(x => x.category))];
}

export function findFoodItem(id) {
  return buildFoodLibrary().find(x => x.id === id) || null;
}
