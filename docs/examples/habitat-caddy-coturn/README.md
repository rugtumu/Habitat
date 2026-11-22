# Habitat VPS kurulumu (Caddy + coturn)

Tek bir VPS üzerinde üç konteyner çalışır:

- **habitat**: bu repodan derlenen sohbet sunucusu (upstream imajı değil)
- **caddy**: HTTPS sertifikasını Let's Encrypt'ten otomatik alır ve yeniler
- **coturn**: ses, kamera ve ekran paylaşımı için TURN aktarıcısı

Varsayılan adres `habitat.umutgur.com`. Farklı bir adres isterseniz yalnızca
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

İlk derleme birkaç dakika sürer. Bittiğinde `https://habitat.umutgur.com`
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
| Kalabalık odada ses/görüntü takılıyor | Ayarlar → Large Server Setup altından ses aktarıcısını açın |
