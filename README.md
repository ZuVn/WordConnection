# Wordchain selfbot

Selfbot Discord tự chơi nối từ tiếng Việt (2 âm tiết) với trọng tài GlitchBucket (`/wordconnect`).

> Selfbot vi phạm Điều khoản dịch vụ của Discord, tài khoản có thể bị khoá. Nên dùng tài khoản phụ.

## Cài đặt

Cần Node.js 20.18 trở lên.

Tạo file `.env` từ file mẫu rồi điền `TOKEN`, `CHANNEL_ID` và các ID khác:

```bash
cp .env.example .env
```

ID lấy bằng cách bật Developer Mode trong Discord, chuột phải vào channel hoặc người dùng, chọn Copy ID.

Lấy token: mở Discord trên trình duyệt, nhấn F12, vào tab Network, bấm sang một channel, chọn một request tới `api` rồi copy giá trị header `authorization`. Không chia sẻ token cho ai. Lỡ để lộ thì đổi mật khẩu Discord để vô hiệu token cũ.

Tạo `client.curl` để bot giả lập đúng trình duyệt bạn đang dùng (nên làm, không bắt buộc). Dùng Chrome hoặc Chromium, cùng tab và cùng tài khoản với lúc lấy token:

1. F12, tab Network, gõ `api/v9` vào ô lọc, bấm sang một channel.
2. Chuột phải vào request `messages?limit=...` (số nào cũng được), chọn Copy, rồi Copy as cURL (bash).
3. Dán vào file `client.curl` trong thư mục này.

File chứa token nên đã nằm trong `.gitignore`. Mỗi lần Chrome hoặc Discord cập nhật lớn, làm lại các bước trên. Không có file này thì bot dùng thông tin Discord Desktop mặc định của thư viện.

## Cách chạy

```bash
npm start
```

Chơi chill (không cố thắng, nghĩ chậm hơn):

```bash
npm run chill
```

## Cách bot phản ứng

| Tín hiệu từ GlitchBucket | Bot làm gì |
|---|---|
| "Lượt nối từ mới đã bắt đầu với từ X" | Bắt đầu ván mới, nối tiếp từ X |
| ✅ hoặc ❕ trên từ của đối thủ | Đến lượt, nối tiếp. Từ chưa có trong db thì thêm vào `Word_to_connect.txt` |
| ❓ trên từ của bot | Không dùng lại từ đó trong ván này, gửi từ khác |
| ❌ trên từ của bot | Giữ từ trong db, gửi từ khác |

Mỗi lượt bot đổi từ tối đa 3 lần. Khi khởi động, bot đọc 100 tin nhắn gần nhất để tiếp tục ván đang dở.

Cách chọn từ: ưu tiên từ chặn (sau nó không còn từ nào nối được) để kết thúc ván. Không có thì tính trước 2 lượt, tránh từ để lại từ chặn cho đối thủ và chọn từ khiến đối thủ có ít lựa chọn nhất.

Chế độ chill: chọn ngẫu nhiên, không dùng từ chặn, ưu tiên từ để đối thủ còn ít nhất 5 cách nối. Sau mỗi từ của đối thủ, bot chờ 10–20 giây mới trả lời (có từ mới thì đếm lại từ đầu). Nếu người khác đã nối đúng 3 từ liền kể từ từ gần nhất của bot thì bot trả lời luôn.
