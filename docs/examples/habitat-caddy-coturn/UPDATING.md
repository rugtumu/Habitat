# Repo güncellendikten sonra sunucuda yapılacaklar

Bu doküman, `main` dalına yeni bir commit gönderildikten sonra değişikliğin
`https://habitat.example.com` adresinde yayına girmesi için sunucuda
yapılması gerekenleri anlatır. İlk kurulum için [README.md](README.md)'ye bakın.

Sunucu kodu GitHub'dan çeker ve imajı kendisi derler. `main`'e gönderilen bir
değişiklik, aşağıdaki adımlar yapılana kadar sitede görünmez.

## Kısa hâli

```bash
ssh KULLANICI@SUNUCU_IP
```

```bash
cd ~/Habitat && git pull --ff-only
```

```bash
cd docs/examples/habitat-caddy-coturn && docker compose up -d --build habitat
```

```bash
docker compose ps
```

Son komutta `habitat` satırı `Up ... (healthy)` göstermelidir. Derleme
bittikten sonra Habitat yaklaşık 20 saniye yeniden başlar; o sırada bağlı
olanların bağlantısı kısa süre kopar ve seste olanlar düşer. Güncellemeyi
kimsenin seste olmadığı bir zamana denk getirin.

## Hangi değişiklik hangi adımı gerektirir

| Değişen şey | Sunucuda yapılacak |
|---|---|
| Uygulama kodu (`src/`, `server.js`, `public/`) | `git pull` + `docker compose up -d --build habitat` |
| Tema ya da eklenti (`themes/`, `plugins/`) | Aynısı. Bu klasörler imajın içindedir, yalnızca `git pull` yetmez |
| `package.json` / `package-lock.json` | Aynısı. Derleme daha uzun sürer (bağımlılıklar yeniden kurulur) |
| `docker-compose.yml` | `git pull` + `docker compose up -d --build` (servis adı vermeden) |
| `Caddyfile` | `git pull` + `docker compose restart caddy` |
| `.env` (sunucuda elle düzenlenir, repoda yoktur) | `docker compose up -d` |
| Yalnızca dokümanlar ya da testler | Hiçbir şey |

Admin panelinden yapılan ayarlar (kayıt jetonu, davet bağlantıları, varsayılan
tema, simge, afiş, roller, kanallar) veritabanında durur. Bunlar için sunucuda
hiçbir işlem gerekmez ve güncellemelerden etkilenmezler.

## Güncellemeden önce

Büyük bir değişiklikten ya da upstream birleştirmesinden önce veriyi yedekleyin.
Tüm veri (veritabanı, yüklenen dosyalar) `habitat_data` biriminde durur:

```bash
docker run --rm -v habitat-caddy-coturn_habitat_data:/data -v "$HOME":/backup alpine tar czf /backup/habitat-data-$(date +%F).tgz -C /data .
```

Birimin adı farklıysa `docker volume ls` ile bakın. Yedek ev klasörünüze yazılır;
sunucu bozulursa işe yaraması için başka bir yere de kopyalayın.

## Güncellemeden sonra kontrol

1. Konteyner sağlıklı mı:

   ```bash
   docker compose ps
   ```

2. Site yanıt veriyor mu (çıktıda `"status":"online"` görünmeli):

   ```bash
   curl -s https://habitat.example.com/api/health
   ```

3. Sunucu doğru commit'te mi:

   ```bash
   git -C ~/Habitat log --oneline -1
   ```

4. Canlıdaki dosyanın çekilen sürümle eşleştiğini doğrulayın. Örneğin ses
   güncellemesinde aşağıdaki iki SHA-256 aynı olmalıdır. Başka bir güncellemede
   o commit’te değişen bir istemci dosyasını seçin.

   ```bash
   sha256sum ~/Habitat/public/js/voice.js
   curl -fsS https://habitat.example.com/js/voice.js -o /tmp/habitat-voice-live.js && sha256sum /tmp/habitat-voice-live.js
   ```

5. Konteyner sağlıklı, dışarıdan sağlık kontrolü başarılı ve dosya eşleşiyorsa
   üyeler sayfayı normal şekilde yenileyebilir. F5 açık ses görüşmesini sonlandırır.
   Görüşmeye dönmek isteyen üye ses odasına tekrar tıklar.

## Tarayıcı tarafında bilinmesi gerekenler

- **Kod ve tema değişiklikleri** normal bir yenilemeyle gelir.
- **Yüklenen görseller** (afiş, simge, avatar) tarayıcıda bir hafta önbellekte
  kalır. Bir görseli sunucuda aynı adreste değiştirmek kullanıcılara ulaşmaz;
  görseli admin panelinden yeniden yükleyin ki yeni bir adres alsın.
- **Sekme simgesi (favicon)** en inatçı önbellektir; sekmeyi kapatıp açmak ya da
  gizli pencere gerekebilir.
- **Ana ekrana eklenmiş uygulama** simgesi ve adı değiştiyse kullanıcının
  kaldırıp yeniden eklemesi gerekir.
- **Eklentiler** her kullanıcının kendi tarayıcısında açılıp kapanır; bir eklenti
  güncellendiğinde yenileme yeterlidir.

## Geri alma

Güncelleme bir şeyi bozduysa önceki çalışan commit'e dönün. Önce commit'i bulun:

```bash
git -C ~/Habitat log --oneline -5
```

Sonra o commit'e geçip yeniden derleyin (`COMMIT` yerine kısa kimliği yazın):

```bash
cd ~/Habitat && git checkout COMMIT && cd docs/examples/habitat-caddy-coturn && docker compose up -d --build habitat
```

Sorun repoda düzeltildikten sonra `main`'e geri dönmek için:

```bash
cd ~/Habitat && git checkout main && git pull --ff-only
```

Veritabanı şemasını değiştiren bir güncellemeden geri dönerken eski kod yeni
şemayla çalışmayabilir. O durumda güncellemeden önce aldığınız yedeği geri
yükleyin; bu yüzden büyük güncellemelerden önce yedek almak önemlidir.

## Sorun çıkarsa

| Belirti | Bakılacak yer |
|---|---|
| `git pull` "not possible to fast-forward" diyor | Sunucudaki kopyada elle değişiklik var. `git status` ile bakın; sunucuda dosya düzenlemeyin, değişikliği repoda yapın |
| Derleme hata veriyor | Çıktının son satırları. Site eski sürümle çalışmaya devam eder; derleme başarısız olursa konteyner değişmez |
| `habitat` sürekli yeniden başlıyor ya da `unhealthy` | `docker compose logs --tail 50 habitat` |
| Site açılmıyor, sertifika hatası | `docker compose logs --tail 50 caddy` |
| Ses bağlanmıyor | `docker compose logs --tail 50 coturn` ve güvenlik duvarı (README'deki port listesi) |
| Disk doluyor | Her derleme eski imajı geride bırakır: `docker image prune -f` |

## Sürekli bakım

- **Eski imajlar:** Birkaç güncellemede bir `docker image prune -f` çalıştırın.
  Her Habitat imajı 1 GB'tan büyüktür.
- **Sistem güncellemeleri:** Ayda bir `apt update && apt upgrade -y`. Çekirdek
  güncellendiyse sunucu yeniden başlatma ister (`reboot`); konteynerler
  `restart: unless-stopped` ile kendiliğinden geri gelir.
- **Caddy ve coturn imajları:** `docker compose pull caddy coturn && docker compose up -d`
  ile güncellenir.
- **Sertifika:** Caddy kendisi yeniler, işlem gerekmez.

## Upstream'den (Haven) güncelleme almak

Bu sunucuda değil, geliştirme bilgisayarında yapılır; sunucu yalnızca
`rugtumu/Habitat` reposunun `main` dalını bilir.

1. Geliştirme bilgisayarında upstream'i bir kez tanıtın:

   ```bash
   git remote add upstream https://github.com/ancsemi/Haven.git
   ```

2. Güncellemeyi alıp birleştirin, çakışmaları çözün ve testleri çalıştırın:

   ```bash
   git fetch upstream && git merge upstream/main
   ```

   ```bash
   npm ci && npm test
   ```

   Tam paket 10 dakikadan uzun sürer. `test/tunnelCloudflared.test.js` içindeki
   iki test bu repodaki değişikliklerden bağımsız olarak başarısız olabiliyor.

3. `main`'e gönderin, sonra bu dokümanın başındaki adımları uygulayın.

Uygulama içindeki **Update Now** düğmesini kullanmayın: Docker kurulumunda
çalışmaz ve upstream'e bakar, bu repoya değil.
