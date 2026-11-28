# Habitat VPS kurulumu (Caddy + coturn)

Tek bir VPS üzerinde üç konteyner çalışır:

- **habitat**: bu repodan derlenen sohbet sunucusu (upstream imajı değil)
- **caddy**: HTTPS sertifikasını Let's Encrypt'ten otomatik alır ve yeniler
- **coturn**: ses, kamera ve ekran paylaşımı için TURN aktarıcısı

Varsayılan adres `habitat.example.com`. Farklı bir adres isterseniz yalnızca
`.env` içindeki `DOMAIN` değerini değiştirin.

## 1. DNS

Alan adı panelinde bir **A kaydı** ekleyin:

| Ad | Tür | Değer |
|---|---|---|
| `habitat` | A | VPS'in IP adresi |

IP adresinin yazıldığı tek yer burasıdır; kurulum dosyalarına IP girilmez.
Alan adı Cloudflare'deyse kaydı **DNS only** (gri bulut) yapın. Turuncu bulut
TURN trafiğini geçirmez.

## 2. Sunucu hazırlığı (Ubuntu 24.04)

```bash
curl -fsSL https://get.docker.com | sh
```

Güvenlik duvarı:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443
ufw allow 3478
ufw allow 49152:65535/udp
ufw allow 40000
ufw enable
```

| Port | Protokol | Ne için |
|---|---|---|
| 80, 443 | TCP (443 ayrıca UDP) | Web ve sertifika |
| 3478 | TCP + UDP | TURN |
| 49152-65535 | UDP | TURN medya aktarımı |
| 40000 | TCP + UDP | İsteğe bağlı ses aktarıcısı (SFU) |

Sağlayıcının panelinde ayrı bir güvenlik duvarı varsa aynı portları orada da
açın.

## 3. Kurulum

```bash
git clone https://github.com/rugtumu/Habitat.git
cd Habitat/docs/examples/habitat-caddy-coturn
cp .env.example .env
openssl rand -hex 32
```

Son komutun çıktısını `.env` içinde `TURN_SECRET` karşısına yazın,
`ADMIN_USERNAME` değerini de belirleyin. Sonra:

```bash
docker compose up -d --build
```

İlk derleme birkaç dakika sürer. Bittiğinde `https://habitat.example.com`
açılmalıdır.

## 4. İlk açılışta yapılacaklar

1. **Hemen** `ADMIN_USERNAME` ile aynı kullanıcı adıyla kaydolun. O adla ilk
   kaydolan admin olur.
2. Kayıt varsayılan olarak herkese açıktır. Admin ayarlarından kayıt jetonunu
   (registration token) veya beyaz listeyi açın ve arkadaşlarınıza davet
   bağlantısı gönderin.
3. Admin hesabında iki adımlı doğrulamayı açın.
4. Ayarlar → Voice & Connectivity → **Test voice connectivity** ile STUN ve
   TURN'ün yanıt verdiğini doğrulayın.
5. Kurulum sihirbazı "Port 3000 is not reachable" diyebilir. Port 3000 bilerek
   dışarı açılmadı, Caddy üzerinden gidiyor; yok sayın.

## 5. Habitat arayüzünü açma

Habitat'ın kendi görünümü üç parçadır. Hepsi repoda hazır gelir, yeni bir şey
kurmak gerekmez.

| Parça | Dosya | Ne yapar |
|---|---|---|
| Tema | `themes/habitat-grafit.theme.css` | Grafit zemin, logodaki yeşim vurgu |
| Açık tema | `themes/habitat-grafit-light.theme.css` | Beyaz sohbet alanı ve gündüz manzarası. Yazı tipleri ve ikonlar için Grafit dosyasını yükler. |
| Yerleşim | `plugins/HabitatLayout.plugin.js` | Hesap ve ses kontrolleri sol altta, kanal ekleme bir `+` düğmesinde, kenar çubuğu araçları sunucu adı menüsünde |
| İkonlar | Haven Glyphs eklentisi | Arayüz emojilerinin yerine Habitat ikonları çizilir |

**Admin, bir kez:**

1. **Themes** seçicisini açın (Habitat yerleşiminde sunucu adının menüsündedir).
   **Habitat Grafit** ve **Habitat Grafit Light** kartlarının **Publish** anahtarlarını açın. Böylece üyeler iki temayı da seçebilir ve
   sunucu şablonu açık temanın kullandığı Grafit dosyasını da içerir.
   Kendi hesabınız için istediğiniz karta tıklayın.
2. Ayarlar → Layout → **Sidebar Layout** altında **Habitat**'ı seçin.
3. Ayarlar → **Interface Icons** altında **Glyphs**'i seçin.
4. Ayarlar → Admin → **Defaults for New Members** bölümünde tema, yerleşim ve
   ikon satırlarını işaretleyip **Use my current settings as the defaults**'a
   basın. Yeni gelen herkes bu görünümle başlar. Mevcut üyelere de vermek için
   **Apply once to everyone now** düğmesini kullanın; kendi ayarını değiştirmiş
   olanlara dokunulmaz.

Yalnızca varsayılan temayı değiştirmek için Ayarlar → Admin → Branding →
Appearance & Welcome → **Default Theme** alanında **Habitat Grafit Light**'ı
seçip **Save Settings** düğmesine basın. Kendi temasını seçmiş üyeler o temayı kullanmaya devam eder.
Her üye tema seçicisinden **Habitat Grafit Light**'a geçebilir. Yerleşim
telefonda ve tablette de çalışır: kenar çubuğu uygulamanın kendi çekmecesinde
aynı düzeni alır, telefonda mesaj kutusundaki araçlar tek bir `+` düğmesine
katlanır. Arama kontrolleri 901 pikselden geniş pencerede sol alta iner; dar
ekranda arama sahnesi açıkken sahnenin altında durur. Vazgeçmek için Layout'tan
**Original**'ı seçmek yeter, her şey eski yerine döner.

İkon eklemek ya da değiştirmek için `scripts/habitat-icons.js` içindeki çizimi
düzenleyip `node scripts/habitat-icons.js` çalıştırın; temadaki ikon bloğu
yeniden yazılır.

## 6. Ses aktarıcısı (isteğe bağlı)

Varsayılan düzende aramadaki herkes sesini ve görüntüsünü diğer herkese ayrı
ayrı gönderir. Ekran paylaşan kişinin yüklemesi odadaki kişi sayısıyla çarpılır;
dört beş kişiden sonra ev bağlantıları yetmez, görüntü donar. Aktarıcı
açıkken herkes bir kez, sunucuya gönderir; sunucu izleyenlere dağıtır.
Paylaşımı kapatan izleyiciye görüntü gönderilmez.

Port (40000, TCP ve UDP) bu kurulumda zaten açık ve `docker-compose.yml`
içinde eşlenmiş durumda. Açmak için admin hesabıyla:

1. Ayarlar → **Large Server Setup** → **Voice relay** altında **Install**'a
   basın. Yaklaşık 10 MB'lık medya motoru veri birimine iner; güncellemeler ona
   dokunmaz.
2. **Built-in relay**'i seçip kaydedin. Durum satırında "running" ve sunucunun
   genel IP adresi görünmeli. Adres yanlışsa **Public address** alanına elle
   yazın.
3. Yeni başlayan bir aramaya girip "Voice Connected" satırına tıklayın;
   **Route** satırında "Through the server (voice relay)" yazmalı. Süren bir
   arama, herkes çıkana kadar başladığı düzende kalır.

Bilinmesi gerekenler:

- Bütün ses ve görüntü VPS'ten geçer. 8 Mbps'lik bir ekran paylaşımını dört
  kişi izlerse sunucudan saniyede 32 Mbps çıkar; bu bir saatte yaklaşık 14 GB
  eder. Sağlayıcının aylık trafik kotasını ve hat hızını buna göre
  değerlendirin.
- Sunucu görüntüyü yeniden kodlamaz, yalnızca iletir; işlemci yükü düşüktür.
- Kapatmak için aynı yerden **Off**'u seçin. Süren aramalar doğrudan
  bağlantıya geçer.

## Güncelleme

Uygulama içindeki **Update Now** düğmesi Docker kurulumunu güncelleyemez.
Bunun yerine:

```bash
cd Habitat
git pull
cd docs/examples/habitat-caddy-coturn
docker compose up -d --build
```

## Yedek

Tüm veri (veritabanı, yüklenen dosyalar) `habitat_data` biriminde durur.
Uygulamanın kendi yedekleme özelliğini kullanın ya da birimi kopyalayın:

```bash
docker run --rm -v habitat-caddy-coturn_habitat_data:/data -v "$PWD":/backup alpine tar czf /backup/habitat-data.tgz -C /data .
```

## Sorun giderme

| Belirti | Olası neden |
|---|---|
| Sertifika alınamıyor | DNS kaydı henüz VPS'i göstermiyor ya da 80/443 kapalı. `docker compose logs caddy` |
| Ses yalnızca bazı kişiler arasında çalışıyor | UDP 3478 veya 49152-65535 kapalı. `docker compose logs coturn` |
| TURN yapılandırılmış ama hiç aktarmıyor | VPS'in arayüzünde özel IP var (`ip -4 addr` ile bakın). `docker-compose.yml` içindeki `--external-ip` satırını açıp genel IP'yi yazın |
| Kalabalık odada ses/görüntü takılıyor | Ses aktarıcısını açın (bölüm 6) |
| Aktarıcı açık ama aramalar bağlanmıyor | 40000 portu (TCP ve UDP) sağlayıcının güvenlik duvarında kapalı ya da **Public address** yanlış. `docker compose logs --tail 50 habitat` içinde "Voice relay" satırına bakın |
