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

## Cách chạy

```bash
npm start
```

## Cách bot phản ứng

| Tín hiệu từ GlitchBucket | Bot làm gì |
|---|---|
| "Lượt nối từ mới đã bắt đầu với từ X" | Bắt đầu ván mới, nối tiếp từ X |
| ✅ hoặc ❕ trên từ của đối thủ | Đến lượt, nối tiếp. Từ chưa có trong db thì thêm vào `Word_to_connect.txt` |
| ❓ trên từ của bot | Xoá từ khỏi `Word_to_connect.txt`, ghi vào `x_word.txt`, gửi từ khác |
| ❌ trên từ của bot | Giữ từ trong db, gửi từ khác |
| "Bạn đã sử dụng một từ không có trong từ điển (X)" | X có trong db thì xoá và ghi vào `x_word.txt` |

Mỗi lượt bot đổi từ tối đa 3 lần. Khi khởi động, bot đọc 100 tin nhắn gần nhất để tiếp tục ván đang dở.

Cách chọn từ: ưu tiên từ chặn (sau nó không còn từ nào nối được) để kết thúc ván. Không có thì tính trước 2 lượt, tránh từ để lại từ chặn cho đối thủ và chọn từ khiến đối thủ có ít lựa chọn nhất.
