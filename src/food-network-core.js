const PAGE_BLUEPRINTS = [
  ['Bếp Nhà Việt Mỗi Ngày','Món cơm gia đình Việt','ấm áp, gần gũi'],
  ['Mâm Cơm Gia Đình','Mâm cơm đủ món','thực tế, dễ làm'],
  ['Cơm Nhà 30 Phút','Món nhanh cho ngày bận','ngắn gọn, tiết kiệm thời gian'],
  ['Bếp Mẹ Nấu','Món truyền thống Việt','thân thuộc, hoài niệm'],
  ['Hôm Nay Ăn Gì','Gợi ý món mỗi ngày','tươi vui, gợi mở'],
  ['Món Ngon Dễ Làm','Công thức cơ bản','rõ bước, dễ theo'],
  ['Bữa Cơm Ấm Nhà','Món gia đình cân bằng','ấm áp, thực dụng'],
  ['Bếp Nhỏ Mỗi Ngày','Món ít nguyên liệu','tối giản, dễ làm'],
  ['Ăn Vặt Tại Nhà','Đồ ăn vặt','trẻ trung, vui vẻ'],
  ['Quà Chiều Dễ Làm','Bánh và món xế','nhẹ nhàng, gần gũi'],
  ['Món Vặt Cuối Tuần','Món vui cho cuối tuần','năng động, dễ thử'],
  ['Bếp Ăn Chơi','Món ăn chơi Việt Nam','vui, ngắn gọn'],
  ['Món Chay Ngon','Món chay gia đình','thanh nhẹ, rõ ràng'],
  ['Bếp Chay Mỗi Ngày','Món chay dễ nấu','đơn giản, cân bằng'],
  ['Chay Dễ Nấu','Công thức chay nhanh','ngắn gọn, thực tế'],
  ['Rau Củ Ngon Lành','Món nhiều rau củ','tươi, lành mạnh'],
  ['Hải Sản Ngon Nhà Làm','Hải sản gia đình','hấp dẫn, thực dụng'],
  ['Bún Phở Mì Tại Nhà','Món nước và món sợi','chi tiết, dễ theo'],
  ['Món Nhậu Tại Gia','Món nhắm và món lai rai','đậm đà, thực tế'],
  ['Bếp Món Nước','Canh, súp, lẩu, bún','ấm áp, chi tiết'],
  ['Món Nướng Cuối Tuần','Món nướng và áp chảo','hấp dẫn, rõ kỹ thuật'],
  ['Món Chiên Giòn Ngon','Món chiên và rim','giòn ngon, rõ mẹo'],
  ['Bánh Ngon Dễ Làm','Bánh và tráng miệng','chính xác, dễ theo'],
  ['Đồ Uống & Tráng Miệng','Đồ uống và món ngọt','tươi mát, dễ làm']
];

const RECIPES = [
  ['Thịt kho trứng','gia_dinh',['500g thịt ba chỉ','6 trứng gà','400ml nước dừa','2 muỗng canh nước mắm','1 muỗng canh đường'],['Thịt cắt miếng, chần nhanh rồi để ráo.','Thắng đường màu cánh gián, cho thịt vào đảo săn.','Thêm nước mắm và nước dừa, kho lửa nhỏ 35 phút.','Cho trứng luộc vào, kho thêm 15 phút rồi nêm lại.'],'Kho lửa nhỏ giúp thịt mềm và nước kho trong.'],
  ['Cá kho tộ','gia_dinh',['600g cá lóc hoặc cá basa','2 muỗng canh nước mắm','1 muỗng canh đường','tiêu','hành tím'],['Cá làm sạch, cắt khúc và ướp nước mắm, hành, tiêu 20 phút.','Thắng màu đường trong nồi đất hoặc nồi đáy dày.','Xếp cá vào, thêm ít nước nóng rồi kho lửa vừa 10 phút.','Hạ nhỏ lửa, kho thêm 20 phút đến khi nước sánh.'],'Không đảo mạnh để cá không vỡ.'],
  ['Gà rang gừng','gia_dinh',['700g thịt gà','40g gừng','2 muỗng canh nước mắm','1 muỗng cà phê đường','hành tím'],['Gà chặt miếng, ướp nước mắm, hành và nửa lượng gừng.','Phi thơm phần gừng còn lại.','Cho gà vào rang lửa vừa đến khi săn.','Thêm ít nước, rim 15 phút cho thấm.'],'Gừng thái sợi mỏng sẽ thơm mà không quá cay.'],
  ['Sườn xào chua ngọt','gia_dinh',['600g sườn non','1 quả ớt chuông','1 củ hành tây','3 muỗng canh sốt cà chua','giấm, đường, nước mắm'],['Sườn chần sạch rồi chiên áp chảo vàng nhẹ.','Pha sốt chua ngọt từ sốt cà, giấm, đường và nước mắm.','Xào hành tây, ớt chuông vừa chín tới.','Cho sườn và sốt vào đảo đến khi bám đều.'],'Không xào rau quá lâu để giữ độ giòn.'],
  ['Canh chua cá','mon_nuoc',['500g cá','1/2 quả dứa','2 quả cà chua','100g giá','me chua','rau ngổ'],['Dầm me với nước nóng, lọc lấy nước chua.','Đun nước me, cho dứa và cà chua vào trước.','Cho cá vào, nấu vừa chín và hớt bọt.','Thêm giá, rau thơm rồi nêm chua ngọt mặn cân bằng.'],'Cho rau thơm sau cùng để giữ mùi.'],
  ['Canh bí đỏ nấu xương','mon_nuoc',['500g xương heo','500g bí đỏ','hành lá','muối','nước mắm'],['Xương chần sạch rồi hầm 30 phút.','Bí đỏ gọt vỏ, cắt miếng vừa.','Cho bí vào nấu 10-12 phút đến mềm.','Nêm vừa ăn và thêm hành lá.'],'Không khuấy nhiều khi bí đã mềm để nước canh không đục.'],
  ['Bò lúc lắc','gia_dinh',['500g thăn bò','1 củ hành tây','1 quả ớt chuông','1 muỗng canh dầu hào','tiêu đen'],['Bò cắt khối, ướp dầu hào và tiêu 15 phút.','Làm nóng chảo thật kỹ, áp chảo bò nhanh từng mẻ.','Xào hành tây và ớt chuông riêng.','Trộn bò với rau, nêm lại rồi tắt bếp.'],'Không cho quá nhiều bò vào chảo cùng lúc để tránh ra nước.'],
  ['Đậu phụ sốt cà chua','chay',['4 bìa đậu phụ','3 quả cà chua','hành lá','1 muỗng cà phê đường','nước tương'],['Đậu cắt miếng và áp chảo vàng.','Cà chua băm nhỏ, xào mềm thành sốt.','Thêm nước tương, đường và ít nước.','Cho đậu vào rim 8 phút rồi thêm hành.'],'Áp chảo đậu trước giúp miếng đậu không nát.'],
  ['Nấm kho tiêu','chay',['400g nấm đùi gà','2 muỗng canh nước tương','1 muỗng cà phê đường','tiêu đen','hành boa-rô'],['Nấm cắt miếng, áp chảo cho hơi xém.','Phi boa-rô, thêm nước tương và đường.','Cho nấm vào đảo đều, thêm ít nước.','Kho lửa nhỏ 10 phút rồi rắc tiêu.'],'Áp chảo nấm giúp vị đậm hơn.'],
  ['Rau củ xào nấm','chay',['150g bông cải','1 củ cà rốt','200g nấm','100g đậu Hà Lan','dầu hào chay'],['Cắt rau củ kích thước đều.','Chần nhanh cà rốt và bông cải.','Xào nấm lửa lớn trước.','Cho rau củ vào, nêm dầu hào chay và đảo nhanh.'],'Xào lửa lớn, thời gian ngắn để rau xanh và giòn.'],
  ['Bún riêu cua','mon_nuoc',['500g cua xay','400g bún','4 quả cà chua','3 bìa đậu phụ','mắm tôm tùy chọn'],['Lọc cua xay với nước, đun lửa vừa để riêu nổi.','Vớt riêu ra, cho cà chua xào vào nước dùng.','Thêm đậu phụ chiên và nêm vị.','Cho bún ra tô, xếp riêu rồi chan nước dùng.'],'Đun cua từ từ để riêu kết mảng đẹp.'],
  ['Phở gà đơn giản','mon_nuoc',['1 con gà nhỏ','500g bánh phở','1 củ hành tây','1 nhánh gừng','quế, hồi'],['Nướng thơm hành và gừng.','Luộc gà cùng hành, gừng và gia vị thơm.','Vớt gà, lọc nước dùng và nêm vừa.','Xé gà, cho vào tô bánh phở rồi chan nước dùng nóng.'],'Hớt bọt đều để nước dùng trong.'],
  ['Mì xào bò','mon_soi',['300g mì','300g thịt bò','200g cải ngọt','1 củ cà rốt','dầu hào'],['Trụng mì vừa mềm rồi xả nhanh.','Bò thái mỏng, ướp dầu hào 10 phút.','Xào bò nhanh lửa lớn rồi lấy ra.','Xào rau và mì, cho bò trở lại, đảo đều.'],'Không trụng mì quá mềm vì còn phải xào.'],
  ['Miến gà','mon_nuoc',['300g miến','500g thịt gà','nấm hương','hành lá','gừng'],['Ngâm miến vừa mềm.','Luộc gà với gừng, vớt ra xé nhỏ.','Cho nấm vào nước luộc và nêm lại.','Cho miến vào tô, xếp gà rồi chan nước dùng.'],'Miến chỉ cần ngâm mềm, không nên nấu lâu.'],
  ['Tôm rang thịt','hai_san',['300g tôm','250g thịt ba chỉ','1 muỗng canh nước mắm','1 muỗng cà phê đường','hành tím'],['Ba chỉ cắt mỏng, rang cho ra bớt mỡ.','Cho hành tím và tôm vào đảo lửa vừa.','Nêm nước mắm, đường rồi đảo đều.','Rang đến khi tôm đỏ bóng và nước cạn.'],'Để vỏ tôm nếu tôm nhỏ sẽ giữ vị ngọt.'],
  ['Mực xào cần tỏi','hai_san',['500g mực','2 cây cần tây','1 củ hành tây','tỏi','dầu hào'],['Mực làm sạch, cắt miếng và khứa nhẹ.','Chần mực 20-30 giây rồi để ráo.','Xào tỏi, hành tây và cần tây lửa lớn.','Cho mực vào đảo nhanh, nêm dầu hào rồi tắt bếp.'],'Mực chỉ xào nhanh để không bị dai.'],
  ['Cá hấp gừng hành','hai_san',['1 con cá khoảng 700g','40g gừng','hành lá','2 muỗng canh nước tương','1 muỗng cà phê dầu mè'],['Cá làm sạch, khứa nhẹ hai bên.','Xếp gừng dưới và trên cá.','Hấp 12-15 phút tùy độ dày.','Rưới nước tương, dầu mè và hành rồi dùng nóng.'],'Không hấp quá lâu làm thịt cá khô.'],
  ['Tôm hấp sả','hai_san',['600g tôm','5 cây sả','lá chanh','muối tiêu chanh'],['Tôm rửa sạch và để ráo.','Đập dập sả, lót dưới đáy nồi.','Xếp tôm lên, thêm lá chanh.','Hấp 6-8 phút đến khi tôm vừa chuyển đỏ.'],'Tôm chín vừa sẽ ngọt và không bở.'],
  ['Gà chiên nước mắm','chien',['700g cánh gà','2 muỗng canh nước mắm','2 muỗng canh đường','tỏi băm','dầu ăn'],['Gà thấm khô rồi chiên vàng, để ráo dầu.','Phi tỏi thơm, thêm nước mắm và đường.','Đun sốt sủi nhẹ đến hơi sánh.','Cho gà vào đảo nhanh để sốt bám đều.'],'Thấm gà thật khô trước khi chiên để hạn chế bắn dầu.'],
  ['Nem rán','chien',['300g thịt xay','100g miến','mộc nhĩ','cà rốt','20 bánh đa nem'],['Ngâm miến, mộc nhĩ rồi cắt nhỏ.','Trộn nhân với thịt, cà rốt và gia vị.','Cuốn nem vừa tay, không quá chặt.','Chiên lửa vừa lần một, nghỉ vài phút rồi chiên lại cho giòn.'],'Chiên hai lần giúp vỏ giòn lâu.'],
  ['Khoai tây chiên giòn','an_vat',['500g khoai tây','1 muỗng cà phê muối','dầu chiên'],['Khoai cắt que đều, ngâm nước lạnh 15 phút.','Luộc sơ 3 phút rồi để thật khô.','Chiên lần một ở nhiệt vừa đến vàng nhạt.','Để nguội rồi chiên lần hai đến giòn.'],'Khoai càng khô trước khi chiên càng giòn.'],
  ['Bánh tráng trộn','an_vat',['200g bánh tráng','xoài xanh','rau răm','đậu phộng','trứng cút','nước sốt me'],['Cắt bánh tráng thành sợi vừa ăn.','Xoài bào sợi, rau răm cắt nhỏ.','Trộn bánh tráng với sốt me trước.','Thêm xoài, trứng cút, đậu phộng và rau răm.'],'Trộn ngay trước khi ăn để bánh không quá mềm.'],
  ['Chân gà sả tắc','an_vat',['700g chân gà','8 cây sả','10 quả tắc','ớt','nước mắm, đường'],['Luộc chân gà với gừng rồi ngâm nước đá.','Pha nước mắm chua ngọt và để nguội.','Thái sả, tắc và ớt.','Ngâm chân gà với hỗn hợp ít nhất 4 giờ trong tủ lạnh.'],'Nước ngâm phải nguội hoàn toàn trước khi trộn.'],
  ['Ngô xào bơ','an_vat',['3 bắp ngô ngọt','20g bơ','hành lá','ruốc tôm tùy chọn','muối'],['Tách hạt ngô và luộc sơ.','Làm chảy bơ trong chảo.','Cho ngô vào xào lửa vừa 5 phút.','Thêm hành và ruốc tôm rồi đảo nhanh.'],'Không xào quá lâu làm hạt ngô khô.'],
  ['Bò nướng lá lốt','nuong',['400g thịt bò xay','30 lá lốt','sả băm','nước mắm','đậu phộng'],['Trộn bò với sả và gia vị.','Cuốn nhân vào lá lốt.','Quét dầu mỏng lên các cuốn.','Nướng hoặc áp chảo đến khi lá thơm và thịt chín.'],'Không cuốn quá dày để nhân chín đều.'],
  ['Gà nướng mật ong','nuong',['800g đùi gà','2 muỗng canh mật ong','1 muỗng canh nước tương','tỏi','tiêu'],['Khứa nhẹ thịt gà.','Ướp gà với mật ong, nước tương, tỏi và tiêu 1 giờ.','Nướng ở 190°C khoảng 30 phút.','Quét thêm sốt ướp và nướng 5-10 phút đến vàng.'],'Mật ong dễ cháy nên chỉ quét dày ở cuối.'],
  ['Sườn nướng mật ong','nuong',['700g sườn','2 muỗng canh mật ong','2 muỗng canh dầu hào','tỏi','tiêu'],['Sườn cắt miếng và ướp ít nhất 1 giờ.','Làm nóng lò hoặc nồi chiên.','Nướng 180°C khoảng 25 phút, lật giữa chừng.','Quét sốt và nướng thêm đến khi bóng vàng.'],'Ướp qua đêm trong tủ lạnh sẽ đậm vị hơn.'],
  ['Ba chỉ nướng sả','nuong',['600g ba chỉ','3 cây sả','1 muỗng canh nước mắm','1 muỗng canh đường','tỏi'],['Ba chỉ thái miếng vừa.','Sả, tỏi băm và trộn cùng gia vị.','Ướp thịt 45 phút.','Nướng hoặc áp chảo đến khi hai mặt xém vàng.'],'Thái thịt không quá mỏng để không bị khô.'],
  ['Lẩu thái hải sản','mon_nuoc',['500g hải sản hỗn hợp','1 lít nước dùng','sả','riềng','lá chanh','cà chua'],['Đun nước dùng với sả, riềng và lá chanh.','Thêm cà chua và gia vị chua cay.','Sơ chế hải sản sạch, để riêng.','Khi ăn mới nhúng hải sản vừa chín.'],'Hải sản cho vào từng đợt để không bị dai.'],
  ['Lẩu gà lá é','mon_nuoc',['1kg thịt gà','200g lá é','300g nấm','sả','ớt xanh'],['Gà chặt miếng, xào săn với sả.','Thêm nước và nấu 20 phút.','Cho nấm vào, nêm vị mặn ngọt vừa.','Khi ăn mới cho lá é và ớt xanh.'],'Lá é chỉ nhúng vừa chín để giữ mùi thơm.'],
  ['Cháo gà','mon_nuoc',['1/2 con gà','150g gạo','gừng','hành lá','tiêu'],['Rang gạo sơ cho thơm.','Luộc gà, giữ lại nước dùng.','Nấu gạo với nước luộc đến nở mềm.','Xé gà, cho vào cháo và nêm lại.'],'Rang gạo giúp cháo thơm và hạt không nát hoàn toàn.'],
  ['Súp gà ngô non','mon_nuoc',['250g thịt gà','1 bắp ngô','100g nấm','1 quả trứng','bột năng'],['Luộc gà, xé sợi.','Nấu ngô và nấm trong nước dùng.','Cho gà vào, tạo độ sánh nhẹ bằng bột năng.','Rót trứng đánh tan thành sợi rồi nêm vị.'],'Cho bột năng từ từ để súp không quá đặc.'],
  ['Cơm rang dưa bò','gia_dinh',['2 bát cơm nguội','250g thịt bò','150g dưa cải chua','1 quả trứng','hành lá'],['Xào bò nhanh rồi lấy ra.','Xào dưa cải cho ráo.','Cho cơm và trứng vào rang tơi.','Trộn bò và dưa trở lại, nêm vừa.'],'Cơm nguội để tủ mát cho hạt cơm săn, dễ rang tơi.'],
  ['Cơm gà xối mỡ','gia_dinh',['2 đùi gà','2 bát cơm','tỏi','nước tương','dưa leo'],['Luộc gà gần chín rồi để thật ráo.','Chiên hoặc xối dầu nóng lên da đến vàng giòn.','Rang cơm với tỏi và ít nước luộc gà.','Dọn gà cùng cơm, dưa leo và nước chấm.'],'Da gà phải thật khô trước khi gặp dầu nóng.'],
  ['Trứng cuộn rau củ','gia_dinh',['4 quả trứng','30g cà rốt','30g hành lá','30g ớt chuông','muối'],['Rau củ băm thật nhỏ.','Đánh trứng với rau và chút muối.','Đổ lớp trứng mỏng, cuộn khi mặt còn hơi ẩm.','Tiếp tục đổ và cuộn đến hết trứng.'],'Dùng lửa nhỏ để cuộn đều mà không cháy.'],
  ['Thịt băm hấp trứng','gia_dinh',['300g thịt băm','3 quả trứng','mộc nhĩ','hành tím','nước mắm'],['Mộc nhĩ ngâm mềm và băm nhỏ.','Trộn thịt, trứng, mộc nhĩ và gia vị.','Cho vào bát chịu nhiệt.','Hấp 20 phút, kiểm tra phần giữa đã chín.'],'Đậy hờ mặt bát để tránh nước hấp nhỏ vào.'],
  ['Bánh xèo miền Nam','banh',['200g bột bánh xèo','250ml nước cốt dừa loãng','200g tôm thịt','giá','hành lá'],['Pha bột với nước cốt dừa và hành lá, nghỉ 20 phút.','Xào sơ tôm thịt.','Đổ lớp bột mỏng vào chảo nóng, thêm nhân và giá.','Đậy nắp 2 phút rồi mở nắp chiên giòn và gập bánh.'],'Chảo thật nóng và ít dầu giúp rìa bánh giòn.'],
  ['Bánh chuối áp chảo','banh',['4 quả chuối chín','120g bột mì','150ml sữa','1 quả trứng','ít đường'],['Nghiền 2 quả chuối, trộn với bột, sữa và trứng.','Hai quả còn lại thái lát.','Đổ bột thành bánh nhỏ trên chảo chống dính.','Đặt lát chuối lên, áp chảo hai mặt vàng.'],'Dùng chuối chín tự nhiên để giảm lượng đường.'],
  ['Bánh flan','trang_mieng',['5 quả trứng','500ml sữa tươi','100g đường','1 muỗng cà phê vani'],['Nấu caramel rồi tráng đáy khuôn.','Hâm sữa ấm, không đun sôi.','Đánh trứng nhẹ, từ từ trộn với sữa và lọc qua rây.','Hấp lửa nhỏ hoặc nướng cách thủy đến khi vừa đông.'],'Không đánh trứng mạnh để flan ít rỗ.'],
  ['Chè đậu xanh','trang_mieng',['200g đậu xanh bỏ vỏ','120g đường','1 lít nước','nước cốt dừa','muối'],['Ngâm đậu 2 giờ rồi rửa sạch.','Nấu đậu với nước đến mềm.','Thêm đường sau khi đậu đã mềm.','Dùng nóng hoặc lạnh với nước cốt dừa.'],'Cho đường sau khi đậu mềm để hạt nhanh nhừ hơn.'],
  ['Chè bưởi','trang_mieng',['200g cùi bưởi','150g đậu xanh','bột năng','đường','nước cốt dừa'],['Sơ chế cùi bưởi nhiều lần để giảm đắng.','Áo cùi bưởi với bột năng rồi luộc đến trong.','Nấu đậu xanh chín vừa, thêm đường.','Cho cùi bưởi vào, tạo độ sánh nhẹ và dùng với nước cốt dừa.'],'Khâu khử đắng cùi bưởi quyết định chất lượng món.'],
  ['Sữa chua trái cây','trang_mieng',['2 hũ sữa chua','1 quả xoài','1 quả táo','100g nho','20g hạt tùy chọn'],['Rửa sạch và cắt trái cây miếng vừa.','Giữ sữa chua lạnh.','Cho trái cây vào ly hoặc bát.','Thêm sữa chua và hạt ngay trước khi dùng.'],'Trái cây nên để ráo để món không bị loãng.'],
  ['Sinh tố xoài','do_uong',['1 quả xoài chín','150ml sữa tươi','50g sữa chua','đá viên'],['Xoài gọt vỏ, cắt miếng.','Cho xoài, sữa và sữa chua vào máy xay.','Xay mịn rồi thêm đá nếu thích.','Dùng ngay khi lạnh.'],'Xoài chín ngọt giúp không cần thêm nhiều đường.'],
  ['Trà đào cam sả','do_uong',['2 túi trà','1 quả cam','2 cây sả','100g đào ngâm','đường hoặc mật ong'],['Ủ trà 5 phút rồi để nguội bớt.','Đập dập sả, nấu nhanh với ít nước.','Trộn trà với nước sả và vị ngọt.','Thêm cam, đào và đá khi trà đã nguội.'],'Không ngâm trà quá lâu để tránh vị chát.'],
  ['Nước chanh sả mật ong','do_uong',['2 quả chanh','3 cây sả','2 muỗng canh mật ong','700ml nước'],['Sả đập dập, đun 5 phút rồi để nguội.','Vắt chanh lấy nước, bỏ hạt.','Trộn nước sả với mật ong.','Chỉ cho nước chanh khi hỗn hợp đã nguội.'],'Không cho chanh vào nước quá nóng để giữ mùi tươi.'],
  ['Salad gà xé','rau_cu',['300g ức gà','xà lách','dưa leo','cà chua bi','nước cốt chanh','dầu ô liu'],['Luộc hoặc áp chảo gà chín rồi xé sợi.','Rau rửa sạch và để thật ráo.','Pha sốt chanh với dầu và chút muối.','Trộn tất cả ngay trước khi ăn.'],'Rau khô giúp sốt bám tốt và salad không ra nước.'],
  ['Gỏi cuốn tôm thịt','rau_cu',['12 bánh tráng','250g tôm','250g thịt ba chỉ','bún','xà lách','hẹ'],['Luộc tôm và thịt, thái vừa ăn.','Chuẩn bị bún, rau và hẹ.','Làm ẩm bánh tráng, xếp nhân gọn.','Cuốn chặt vừa tay và dùng cùng nước chấm.'],'Không nhúng bánh tráng quá ướt vì bánh sẽ dễ rách.'],
  ['Gỏi gà bắp cải','rau_cu',['400g thịt gà','300g bắp cải','1 củ cà rốt','rau răm','chanh, nước mắm, đường'],['Luộc gà và xé sợi.','Bắp cải, cà rốt thái mỏng.','Pha nước trộn chua ngọt.','Trộn rau trước, sau đó cho gà và rau răm.'],'Trộn sát giờ ăn để bắp cải còn giòn.'],
  ['Cà tím nướng mỡ hành','chay',['3 quả cà tím','hành lá','2 muỗng canh dầu','đậu phộng','nước tương'],['Nướng cà tím đến khi mềm.','Bóc bớt vỏ cháy và xẻ dọc.','Làm nóng dầu, rưới lên hành lá.','Rưới mỡ hành và nước tương lên cà, thêm đậu phộng.'],'Nướng cả vỏ giúp cà giữ độ ẩm.'],
  ['Đậu hũ kho nấm','chay',['4 bìa đậu hũ','250g nấm','2 muỗng canh nước tương','1 muỗng cà phê đường','tiêu'],['Đậu áp chảo vàng.','Nấm xào cho săn.','Thêm nước tương, đường và ít nước.','Cho đậu vào kho 10 phút rồi rắc tiêu.'],'Dùng nấm đùi gà hoặc nấm hương để vị đậm hơn.']
];

export function foodPageBlueprints() {
  return PAGE_BLUEPRINTS.map(([name, theme, voice], index) => ({
    slot: index + 1,
    name,
    theme,
    voice,
    daily_post_hour: 7 + ((index * 37) % 13),
    daily_post_minute: [0,10,20,30,40,50][index % 6]
  }));
}

export function foodRecipes() {
  return RECIPES.map(([title, category, ingredients, steps, tip], index) => ({
    id: index + 1,
    title,
    category,
    ingredients,
    steps,
    tip
  }));
}

export function plannedCreateDate(startDate, slot) {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) throw new Error('startDate không hợp lệ');
  const monthOffset = Math.floor((slot - 1) / 2);
  const secondInMonth = (slot - 1) % 2 === 1;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthOffset, secondInMonth ? 15 : 1, 9, 0, 0));
  if (slot === 1 && d < start) return new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  return d.toISOString();
}

export function pickRecipeForPage({ pageSlot, date, usedRecipeIds = [] }) {
  const recipes = foodRecipes();
  const day = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86400000);
  const used = new Set(usedRecipeIds.map(Number));
  for (let offset = 0; offset < recipes.length; offset++) {
    const index = (day + pageSlot * 7 + offset * 13) % recipes.length;
    const recipe = recipes[index];
    if (!used.has(recipe.id)) return recipe;
  }
  return recipes[(day + pageSlot) % recipes.length];
}

const RECIPE_CATEGORY_GUIDE = {
  gia_dinh: {
    serving:'3-4 người',
    finish:'Món đạt khi nguyên liệu chín mềm hoặc chín tới đúng đặc trưng, gia vị bám đều và mùi thơm rõ nhưng không bị khô.',
    mistake:'Tránh nêm quá đậm ngay từ đầu. Nên nêm khoảng 70-80% trước, sau đó chỉnh lại ở cuối khi nước/sốt đã cô bớt.'
  },
  mon_nuoc: {
    serving:'3-4 người',
    finish:'Nước dùng có vị cân bằng, không bị gắt mặn/chua/ngọt; phần cái vừa chín, không nát và mùi rau thơm còn rõ.',
    mistake:'Không đun sôi quá mạnh trong thời gian dài nếu muốn nước dùng trong. Rau thơm và nguyên liệu nhanh chín nên cho gần cuối.'
  },
  mon_soi: {
    serving:'2-3 người',
    finish:'Sợi chín vừa, tơi, không bở; phần thịt/rau còn độ ẩm và gia vị phủ đều quanh sợi.',
    mistake:'Không trụng sợi quá mềm vì còn một bước xào/nấu tiếp. Nếu sợi dính, xả hoặc trộn một lớp dầu thật mỏng trước khi chế biến.'
  },
  chay: {
    serving:'3-4 người',
    finish:'Rau/nấm/đậu giữ được cấu trúc, thấm gia vị nhưng không nát; vị ngọt tự nhiên của nguyên liệu vẫn còn.',
    mistake:'Nấm và rau nhiều nước nên dùng chảo nóng, không cho quá đầy chảo để tránh món bị hấp hơi và ra nhiều nước.'
  },
  hai_san: {
    serving:'3-4 người',
    finish:'Hải sản vừa chín, thịt săn nhưng còn mọng nước, không có mùi tanh gắt và không bị dai.',
    mistake:'Hải sản rất dễ quá lửa. Chuẩn bị sẵn gia vị trước khi nấu và dừng nhiệt ngay khi vừa đạt độ chín.'
  },
  chien: {
    serving:'3-4 người',
    finish:'Bề mặt vàng, ráo và giòn; bên trong chín nhưng không khô. Nếu có sốt, sốt chỉ bám một lớp vừa đủ.',
    mistake:'Nguyên liệu còn ướt sẽ làm bắn dầu và khó giòn. Không cho quá nhiều vào chảo cùng lúc vì nhiệt dầu tụt nhanh.'
  },
  an_vat: {
    serving:'2-3 người',
    finish:'Món có cấu trúc rõ: món giòn vẫn giòn, món trộn không bị nhũn và vị chua-ngọt-mặn hài hòa.',
    mistake:'Các món trộn nên hoàn thiện sát giờ ăn. Thành phần giòn và đậu phộng/hành phi nên cho ở cuối.'
  },
  nuong: {
    serving:'3-4 người',
    finish:'Mặt ngoài vàng/xém thơm, phần trong chín đều và còn độ ẩm; sốt ướp không bị cháy đen.',
    mistake:'Nên làm nóng thiết bị trước. Các sốt có đường hoặc mật ong dễ cháy, vì vậy quét dày ở giai đoạn cuối thay vì ngay từ đầu.'
  },
  banh: {
    serving:'3-4 phần',
    finish:'Bánh chín đều, giữ đúng kết cấu của món: phần cần giòn thì giòn, phần ruột cần mềm thì không bị khô.',
    mistake:'Đong nguyên liệu theo đúng định lượng gốc và kiểm soát nhiệt ổn định; thay đổi lượng chất lỏng tùy tiện dễ làm sai kết cấu.'
  },
  trang_mieng: {
    serving:'4 phần',
    finish:'Độ ngọt vừa, kết cấu mịn hoặc mềm đúng đặc trưng và không có mùi trứng/bột sống.',
    mistake:'Không tăng nhiệt chỉ để rút ngắn thời gian. Món ngọt thường dễ tách nước, rỗ mặt hoặc cháy đáy khi nhiệt quá cao.'
  },
  do_uong: {
    serving:'2-3 ly',
    finish:'Mùi nguyên liệu chính rõ, vị ngọt/chua cân bằng và đồ uống không bị đắng hoặc nhạt do quá nhiều đá.',
    mistake:'Các thành phần có vị chua hoặc hương tươi nên cho khi nền nước đã nguội bớt; nếm lại sau khi thêm đá.'
  },
  rau_cu: {
    serving:'3-4 người',
    finish:'Rau củ giữ màu, còn độ giòn hoặc mềm vừa theo món, không ra quá nhiều nước.',
    mistake:'Rau sau khi rửa cần để ráo. Không trộn/xào quá lâu vì rau dễ mất độ giòn và tiết nước.'
  }
};

function techniqueNote(step = '') {
  const text = String(step).toLowerCase();

  if (/ướp/u.test(text)) {
    return 'Trộn kỹ để gia vị phủ đều các mặt. Trong thời gian ướp nên để nguyên liệu nghỉ yên; nếu ướp lâu, bảo quản trong ngăn mát.';
  }
  if (/chiên|rán/u.test(text)) {
    return 'Làm nóng dầu/chảo trước khi cho nguyên liệu vào. Chia thành từng mẻ nếu cần để nhiệt không tụt và bề mặt lên màu đều.';
  }
  if (/áp chảo/u.test(text)) {
    return 'Bề mặt nguyên liệu nên ráo. Đặt vào chảo đã nóng và hạn chế đảo liên tục để tạo màu xém thơm.';
  }
  if (/xào/u.test(text)) {
    return 'Chuẩn bị sẵn toàn bộ nguyên liệu trước khi bật bếp. Với bước xào nhanh, dùng chảo nóng và đảo gọn tay để nguyên liệu không ra nhiều nước.';
  }
  if (/kho|rim/u.test(text)) {
    return 'Sau khi hỗn hợp sôi, hạ nhiệt để món thấm từ từ. Quan sát lượng nước/sốt và chỉ đảo nhẹ để nguyên liệu không vỡ.';
  }
  if (/hấp/u.test(text)) {
    return 'Nên đợi nước trong nồi hấp sôi ổn định rồi mới đặt món vào. Hạn chế mở nắp nhiều lần vì nhiệt và hơi nước sẽ thất thoát.';
  }
  if (/nướng/u.test(text)) {
    return 'Làm nóng lò/nồi chiên trước khi nướng. Theo dõi màu bề mặt ở giai đoạn cuối vì sốt có đường, mật ong hoặc dầu hào dễ sậm màu nhanh.';
  }
  if (/luộc|chần/u.test(text)) {
    return 'Dùng lượng nước đủ ngập hoặc tiếp xúc đều với nguyên liệu. Sau khi đạt độ chín yêu cầu nên vớt ra đúng lúc để tránh chín quá.';
  }
  if (/nấu|hầm/u.test(text)) {
    return 'Sau khi sôi, điều chỉnh lửa để món chỉ sôi vừa. Hớt bọt nếu có và nêm hoàn thiện ở cuối khi hương vị đã ổn định.';
  }
  if (/trộn/u.test(text)) {
    return 'Trộn từ dưới lên và vừa đủ để sốt phủ đều. Không bóp hoặc đảo quá mạnh với nguyên liệu mềm, rau và bánh tráng.';
  }
  if (/xay/u.test(text)) {
    return 'Xay theo từng nhịp ngắn, kiểm tra độ mịn giữa các lần để tránh làm hỗn hợp nóng lên hoặc loãng quá mức.';
  }
  if (/ngâm/u.test(text)) {
    return 'Dùng dụng cụ sạch và bảo đảm phần nước ngâm đã ở nhiệt độ phù hợp trước khi cho nguyên liệu vào.';
  }
  if (/thắng đường|caramel|màu cánh gián/u.test(text)) {
    return 'Dùng nồi/chảo khô, đun đường ở lửa vừa đến khi chuyển màu hổ phách hoặc cánh gián rồi hạ nhiệt. Không để đường chuyển nâu đen vì sẽ sinh vị đắng.';
  }
  if (/nêm lại|nêm vừa|nêm vị|nêm chua|nêm/u.test(text)) {
    return 'Nếm ở giai đoạn cuối khi lượng nước/sốt đã gần ổn định. Chỉnh từng ít một để tránh quá mặn, quá ngọt hoặc quá chua.';
  }

  return 'Thực hiện đúng thứ tự và quan sát trạng thái thực tế của nguyên liệu; không chỉ phụ thuộc tuyệt đối vào thời gian vì kích thước miếng và công suất bếp có thể khác nhau.';
}

function buildDetailedStep(step, index) {
  const base = String(step || '').trim().replace(/[.。]+$/u, '');
  return `${index + 1}. ${base}.\n   → ${techniqueNote(base)}`;
}

function buildIngredientPrep(recipe) {
  const lines = [];

  for (const ingredient of recipe.ingredients || []) {
    const raw = String(ingredient || '').trim();
    if (!raw) continue;

    const text = raw.toLowerCase();
    let note = 'Chuẩn bị đúng định lượng, để riêng trước khi bắt đầu nấu.';

    // Order matters: "trứng gà" must be classified as egg, not poultry.
    if (/trứng/u.test(text)) {
      note = 'Kiểm tra vỏ nguyên, sạch; luộc hoặc đập trứng theo đúng bước công thức và để riêng khỏi thực phẩm đã chín.';
    } else if (/thịt|thăn bò|ba chỉ|sườn|cánh gà|đùi gà|thịt gà|con gà|ức gà|xương heo|chân gà/u.test(text)) {
      note = 'Sơ chế sạch, thấm hoặc để ráo trước khi ướp, áp chảo, chiên hay nướng để gia vị bám tốt và hạn chế bắn dầu.';
    } else if (/cá|tôm|mực|hải sản|cua/u.test(text)) {
      note = 'Làm sạch, loại bỏ phần không dùng, rửa nhanh khi cần rồi để thật ráo; hải sản nên được chế biến vừa chín để tránh khô hoặc dai.';
    } else if (/rau|hành|gừng|sả|cà chua|dứa|cà rốt|nấm|ớt|xoài|chanh|tắc|lá|bông cải|giá|dưa leo|bắp cải|cần tây/u.test(text)) {
      note = 'Rửa/sơ chế sạch, để ráo và cắt đồng đều theo kích thước phù hợp để chín đều.';
    } else if (/bún|mì|miến|bánh|gạo|cơm/u.test(text)) {
      note = 'Chuẩn bị riêng và chỉ làm mềm đến mức cần thiết vì nguyên liệu còn tiếp tục chín ở bước chế biến sau.';
    } else if (/nước mắm|nước tương|dầu hào|đường|muối|tiêu|giấm|mật ong|dầu mè|nước cốt|sữa|bơ/u.test(text)) {
      note = 'Đong sẵn đúng lượng ghi trong công thức; chưa đổ toàn bộ vào món cho đến đúng bước để còn khoảng điều chỉnh vị ở cuối.';
    }

    lines.push(`- ${raw}: ${note}`);
  }

  return lines.join('\n');
}

export function buildRecipePost({ page, recipe }) {
  const introByVoice = {
    'ấm áp, gần gũi': `Hôm nay vào bếp với ${recipe.title} - món ngon dễ đưa cơm và hợp cho bữa nhà.`,
    'thực tế, dễ làm': `${recipe.title} là lựa chọn dễ triển khai với nguyên liệu quen thuộc.`,
    'ngắn gọn, tiết kiệm thời gian': `Gợi ý hôm nay: ${recipe.title}. Mình vẫn ghi đủ định lượng và kỹ thuật quan trọng để bạn làm ổn ngay từ lần đầu.`,
    'thanh nhẹ, rõ ràng': `${recipe.title} - một món nhẹ nhàng, dễ chuẩn bị tại nhà.`
  };

  const intro = introByVoice[page.voice] ||
    `Món hôm nay: ${recipe.title}. Dưới đây là công thức chi tiết, đi từ chuẩn bị nguyên liệu đến cách nhận biết món đã đạt.`;

  const guide = RECIPE_CATEGORY_GUIDE[recipe.category] || {
    serving:'3-4 người',
    finish:'Món chín đều, hương vị cân bằng và giữ được đặc trưng chính của nguyên liệu.',
    mistake:'Nêm từng bước và quan sát trạng thái thực tế thay vì chỉ phụ thuộc vào thời gian.'
  };

  const ingredients = recipe.ingredients.map(x => `- ${x}`).join('\n');
  const prep = buildIngredientPrep(recipe);
  const steps = recipe.steps.map(buildDetailedStep).join('\n\n');
  const hashtags = ['#HuongDanNauAn','#BepNha','#CongThucNauAn'];

  const content = [
    intro,
    '',
    'CÔNG THỨC CHI TIẾT',
    `Khẩu phần tham khảo: ${guide.serving}`,
    '',
    'NGUYÊN LIỆU',
    ingredients,
    '',
    'SƠ CHẾ & CHUẨN BỊ',
    prep,
    '',
    'CÁCH LÀM CHI TIẾT',
    steps,
    '',
    'DẤU HIỆU MÓN ĐẠT',
    guide.finish,
    '',
    'MẸO QUAN TRỌNG',
    recipe.tip,
    '',
    'LỖI THƯỜNG GẶP & CÁCH TRÁNH',
    guide.mistake,
    '',
    'CÁCH DÙNG & BẢO QUẢN',
    'Nên dùng món ở trạng thái phù hợp nhất ngay sau khi hoàn thiện. Nếu chưa dùng ngay, để món nguội bớt, cho vào hộp sạch có nắp và bảo quản lạnh; khi dùng lại cần kiểm tra mùi, trạng thái và hâm nóng phù hợp với loại món.',
    '',
    hashtags.join(' ')
  ].join('\n');

  const imagePrompt = `Ảnh chụp món ăn ${recipe.title}, món ăn Việt Nam trình bày hấp dẫn trên bàn ăn gia đình, ánh sáng tự nhiên, food photography chân thực, góc chụp 45 độ, chi tiết món ăn rõ, không chữ, không logo, không người, khung vuông 1:1.`;

  return {
    content,
    imagePrompt,
    recipeDetail: {
      serving:guide.serving,
      ingredient_count:recipe.ingredients.length,
      step_count:recipe.steps.length,
      format_version:'detailed-v2'
    }
  };
}

export function localDateInVietnam(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const map = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
