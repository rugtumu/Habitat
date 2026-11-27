# Habitat arayüz planı

27 Kasım 2026. İki bağımsız incelemeden çıktı: Codex kodu taradı (envanter, tutarsızlık sayımı, risk listesi), Claude yerel sunucuda arayüzü açıp baktı ve yüklemeyi ölçtü. Codex'in öne çıkan dokuz bulgusu kodda tek tek doğrulandı; aşağıda "doğrulandı" diye işaretli olanlar bunlar.

Karar çerçevesi: Haven'in sunucusunda kalıyoruz, `src/` ve `server.js` içine girmiyoruz. Arayüzde (`public/`, tema, eklenti) serbestiz: giydirmek, gizlemek, silmek, eklemek.

## Bugünkü durumun özeti

- **Yüklenirken Haven görünüyor.** Tema 32. milisaniyede geliyor, düzeni kuran eklenti 201. milisaniyede (yerel ölçüm; internet üzerinden daha uzun). Arada sayfa Haven'in dizilişiyle çiziliyor: hesap üstte, Join formu kanal listesinde, DM'ler kanalların altında. Sonra her şey yer değiştiriyor. Sayfa 245 dosya istiyor, 142'si betik.
- **Her açılışta "Haven Desktop App" tanıtımı çıkıyor** (1,2 saniye sonra), doğrulandı.
- **Kalabalık:** kanal başlığında 7 ikon ve güncelleme hapı, her mesajda 12 düğmeli araç çubuğu, her bağlantı önizlemesinde boyut seçici, rayda üç yardımcı düğme, sunucu menüsünde hesap, tema, oyun, bağış ve hata ayıklama karışık.
- **Kimsenin kullanmadığı Haven parçaları çalışıyor:** oyun skorları her açılışta sunucudan isteniyor (doğrulandı), bağışçı listesi açılmadan indiriliyor, hata ayıklama çubuğu, efekt konsolu, ses panosu kenar sekmesi.
- **Kendi temamız tutarsız:** 19 köşe yarıçapı, 24 yazı boyutu, 9 yazı ağırlığı, 31 boşluk değeri, 13 gölge, 6 süre, 26 elle yazılmış renk.
- **Gerçek hatalar:** yazı boyutunu %110 yapmak mesaj yazısını küçültüyor (doğrulandı: Haven 0,875rem'den, biz 1,0625rem'den hesaplıyoruz); sahnenin görünüşü tema ile eklentinin yüklenme sırasına bağlı (doğrulandı: aynı seçici iki yerde farklı tanımlı); sahne düğmeleri gerçek düğme devre dışıyken tıklanabilir görünüyor (doğrulandı); okunmamış her kanal kırmızı rozet alıyor, bahsetme ile ayırt edilmiyor (doğrulandı); telefonda iki parmakla yakınlaştırma kapalı (doğrulandı).

## İlkeler

1. **Önce çıkar, sonra ekle.** Bir yüzeyde iş, orada ne kalacağına karar vermekle başlar.
2. **Tek ölçek.** Köşe 0/6/8/12/20/yuvarlak. Yazı 12/14/16/18/24/32. Ağırlık 400/500/600/700. Boşluk 0/2/4/8/12/16/24/32/48. Gölge: yok, açılır menü, pencere. Hareket: 120 ms geri bildirim, 180 ms giriş, tek eğri.
3. **Her etkileşimin sekiz durumu.** Üzerine gelme, basma, klavye odağı, devre dışı, seçili, yükleniyor, boş, hata. Eksik olan "bitmedi" sayılır.
4. **Silmeden önce bağımlılığa bak.** Haven'in betikleri bazı öğelere doğrudan yazıyor; öğe yoksa bağlantı kurulumu yarıda kalır (örnek: durum çubuğu metni). Önce yazan kod düzeltilir, sonra öğe kalkar.
5. **Her tur ölçülür.** 1440 ve 375 genişlikte ekran görüntüsü, sayfadan okunan değerler, Habitat testleri. Yükleme ve kare hızı için sayı.

## Aşamalar

Boyutlar: K bir saatten az, O bir günden az, B bir günden çok. "Kim" sütunu ilk yazarı gösterir; her Codex işini Claude tarayıcıda doğrular ve gözden geçirir.

### 1. İlk izlenim: açılış

Hedef: sayfa ilk karede Habitat olarak çizilir, hiçbir şey yer değiştirmez, hiçbir pencere kendiliğinden açılmaz.

| İş | Boyut | Kim |
|---|:---:|---|
| Kabuğu son yerleşimiyle çiz: hesap altta, Join formu yok, DM ve kanallar tek liste. Eklenti bölgeleri taşımak yerine hazır bulur | B | Codex, Claude ölçer |
| Yeni tarayıcıda Grafit, Habitat düzeni ve ikonlar tek varsayılan olarak gelsin; kişisel seçim ve güvenli kip korunur | O | Codex |
| Masaüstü uygulama tanıtımını ve kuyruğunu kaldır | K | Codex |
| Giriş sonrası karşılama: "kodla katıl, kanal oluştur" yerine kanal seçimi ve arama; sunucu adı boşken "HAVEN" yazmasın | K | Claude |
| Geçmiş yüklenirken "sohbetin başlangıcı" yazısı görünmesin: yükleniyor, boş ve hata ayrı durumlar | O | Codex |
| Telefonda tarayıcı çubuğu rengi ilk karede doğru; ana yazı tipi önceden yüklensin | O | Claude |

Bitti sayılır: yerelde ve yavaşlatılmış bağlantıda yükleme kaydında yer değiştiren bölge yok; açılışta pencere yok.

### 2. Sadeleştirme: gereksizi kaldır

Hedef: bir üyenin gördüğü her şey bu sunucuda işe yarar.

| İş | Boyut | Kim |
|---|:---:|---|
| Oyun başlatıcı, skor istekleri, üye listesindeki kupa ve rekor bildirimleri | O | Codex |
| Bağışçı satırı ve penceresi; Haven'e teşekkür "Hakkında" bölümüne | K | Codex |
| Güncelleme hapı, "Yenilikler" ve rol geçişi bildirimi yönetici bakım sayfasına; disk uyarısı kalır | O | Codex |
| Hata ayıklama çubuğu: önce bağlantı kodunun oraya yazması düzeltilir, sonra çubuk kalkar; ping ve sürüm bağlantı ayrıntılarına | O | Codex |
| Ray: Mesajlar, ana sunucu, katılınan sunucular. Ekle, Yönet, Eşitle tek menüde | O | Claude |
| Sunucu menüsü yalnız sunucu işleri; profil ve çıkış hesap menüsüne; tüm sunucu adı tıklanabilir | O | Claude |
| Kanal satırlarında üstü çizili özellik ikonları kalkar; gizlilik, okunmamış, aktif çağrı kalır | K | Claude |
| Tema ve efekt konsolu: kişisel tema Görünüm'e, yayınlama yöneticiye, efektler normal yoldan çıkar | O | Codex |
| Ses panosu kenar sekmesi ve Birlikte Dinle: çağrı içinde tek "ekstralar" menüsü | O | Codex |
| Kanal başlığı: başlık, üye önizlemesi, arama, çağrı. Kod yönetimi ve toplu taşıma yönetim alt grubuna | K | Claude |

### 3. Günlük yüzeyler

Hedef: en çok bakılan dört yüzey (mesaj, yazma alanı, kanal listesi, üye) Discord kullanıcısına tanıdık ve sakin.

| İş | Boyut | Kim |
|---|:---:|---|
| Mesaj araç çubuğu: tepki, yanıt, düzenle, diğer. Kalan sekiz eylem "diğer" içinde; Shift ile sil yerinde | O | Claude |
| Yazma alanı varsayılanı: ek, metin, emoji, gönder. GIF ve sesli mesaj bir tık uzakta; anket, zaman, biçim "+" içinde | O | Codex |
| Okunmamış sakin (koyu yazı, nokta), bahsetme belirgin (sayı rozeti) | O | Claude |
| Bağlantı önizlemesi: boyut seçici kalkar, tek boyut, kart sadeleşir | K | Claude |
| Ekle/Katıl penceresi: Kodla katıl, Metin kanalı, Sesli oda. Gelişmiş seçenekler tek açılırda; hata olursa pencere açık kalır | O | Codex |
| Hızlı geçiş (Ctrl/Cmd+K): sonuç yoksa açıklama; Esc yalnız en üstteki yüzeyi kapatır; Shift+Esc tümünü okundu yapar | O | Codex |
| Üye satırı: ad, durum, profil. İkincil eylemler profil kartında; doğum günü ve rol süsü kartta | K | Claude |
| Bildirimler: kayıt gibi rutin onaylar eylemin yanında; hata ve cevapsız çağrı görünür ve ekran okuyucuya duyurulur | O | Codex |

### 4. Tutarlılık ve durumlar

Hedef: yan yana duran iki öğe aynı ölçekten gelir; her kontrolün her durumu tanımlı.

| İş | Boyut | Kim |
|---|:---:|---|
| Ölçekleri belirteç olarak tanımla; menüler, pencereler ve ayarlardan başlayarak sapanları topla | O | Claude |
| Sahne yüzeyi ve boşlukları tek yerde tanımlı; eklenti değişkenleri okur | K | Claude |
| Yazı boyutu ayarı Grafit'te her yüzdede büyütsün | O | Claude |
| Ortak devre dışı, meşgul ve geçersiz alan görünümü | O | Claude |
| Kanal, üye ve mesaj satırlarına klavye yolu ve görünür odak | B | Codex |
| Renk, gölge ve köşe geçişleri kalkar (depo kuralı: yalnız opaklık, kaydırma, ölçek, döndürme) | K | Claude |

### 5. Ayarlar

Hedef: üye beş sayfa görür, aradığını ilk bakışta bulur.

| İş | Boyut | Kim |
|---|:---:|---|
| Üye: Profil ve hesap, Sohbet ve medya, Ses ve video, Bildirimler, Arayüz ve erişilebilirlik (bugün 10 sayfa) | O | Codex |
| Skor rozetleri bölümü kalkmadan önce içindeki iki NSFW ayarı İçerik ve gizlilik'e taşınır | K | Codex |
| Yönetici: Sunucu ve kanallar, Kişiler ve güvenlik, İçerik ve bağlantılar, İşletim (bugün 6 sayfa, içerik karışık) | B | Codex |
| Sayfaların görünüşü: tek sütun genişliği, bölüm başlıkları, anahtarlar, yardım metni aynı ölçekten | O | Claude |

### 6. Çağrı

| İş | Boyut | Kim |
|---|:---:|---|
| Sahne düğmeleri gerçek düğmenin devre dışı ve gizli durumunu yansıtsın | K | Claude |
| Kutucuk büyütme klavyeyle de yapılabilsin | O | Claude |
| Düzen, boyut ve tanılama eylemleri tek çağrı menüsünde | O | Claude |
| Gerçek kamera, gerçek ekran paylaşımı, üç ve daha çok kişi: gerçek çağrıda deneme | – | Erdem ve arkadaşlar |

### 7. Telefon

| İş | Boyut | Kim |
|---|:---:|---|
| İki parmakla yakınlaştırmayı aç | K | Claude |
| Sunucu değiştirme tek yerde (çekmece); başlıktaki ikinci seçici kalkar | O | Claude |
| 375 genişlikte her yüzeyin geçişi: başlık, çekmeceler, yazma alanı, sahne, ayarlar | O | Claude |
| Ana ekrana eklenmiş hâlde gerçek telefonda deneme: bildirim, arka planda ses | – | Erdem |

### Sonraya bırakılanlar

Açık tema, kabuk mobil uygulama, kendi istemcimiz. Üçü de bu plan bittikten sonra daha ucuz olur, çünkü arayüz sadeleşmiş ve ölçekler tek olur.

## Codex ile çalışma düzeni

- **Tur başına tek yazar, tek dosya kümesi.** Codex `public/app.html` ve `public/js/modules/` içindeki kaldırma ve yeniden gruplama işlerini yapar; Claude tema, eklenti CSS'i ve ölçümü. Aynı turda aynı dosyaya iki el girmez.
- **Her Codex işi bir brifle başlar:** hedef, dokunulacak dosyalar, korunacak davranış, risk listesinden ilgili satırlar, çalıştırılacak testler. Codex sayfayı göremez; görünüşü Claude tarayıcıda doğrular.
- **Her tur sonunda:** Habitat testleri, kaynak dosyaları okuyan Haven testleri (tema sözleşmesi, ayar araması, yazma alanı düğmeleri, i18n), 1440 ve 375 ekran görüntüleri. Commit ve push yalnız Erdem isteyince.
- **Kaldırılan her şey için risk listesine bakılır.** En tehlikeliler: durum çubuğu metinleri, yazma alanı düğme kimlikleri, ayar gezinme öğeleri, çağrı düğmelerinin asılları, bildirim kabı.

## Karar bekleyenler

Bunlar özellik kaldırıyor; Erdem ve Umut'un sözü gerekir.

1. Oyunlar ve skor tablosu tümüyle kalksın mı?
2. Ses panosu ve Birlikte Dinle kalsın mı (çağrı menüsüne taşınarak), kalksın mı?
3. Forum türü kanallar: yeni forum açma gizlensin mi? (Var olanlar okunmaya devam eder.)
4. Efekt konsolu (kar, CRT, RGB) normal yoldan çıksın mı?
5. Güncelleme hapı yalnız yöneticiye, ayarlar içinde görünsün mü?
6. `AGENTS.md` içindeki "fork küçük kalır, önce tema ya da eklenti" kuralı yeni karara göre güncellensin mi?

## Sıra önerisi

1 → 2 → 3 → 4, ardından 5, 6, 7. İlk iki aşama en çok hissedilen farkı verir ve sonraki aşamaların işini azaltır: kaldırılan yüzeyi cilalamak gerekmez. 4. aşamanın ölçek belirteçleri 1. aşamayla birlikte tanımlanır ki yeni yazılan her şey baştan ölçeğe otursun.
