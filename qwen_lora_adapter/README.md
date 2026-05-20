# Qwen2-1.5B LoRA Adapter (Vietnamese)

README này giải thích chi tiết các file trong thư mục và luồng hoạt động hệ thống của adapter LoRA fine-tune tiếng Việt.

## Tổng quan

- Base model: `Qwen/Qwen2-1.5B`
- LoRA: `r=8`, `alpha=16`, `dropout=0.05`
- Target modules: `q_proj`, `k_proj`, `v_proj`, `o_proj`
- Task: `CAUSAL_LM` / chat-instruction
- Kiến trúc: chỉ fine-tune adapter, giữ nguyên trọng số base model

## Cấu trúc thư mục và ý nghĩa từng file

- `adapter_config.json`
  - Cấu hình PEFT/LoRA của adapter.
  - Chỉ định `peft_type: LORA`, `r`, `alpha`, `dropout`, và `target_modules`.
  - Thông tin quan trọng: `base_model_name_or_path` là `Qwen/Qwen2-1.5B`.

- `adapter_model.safetensors`
  - File nhị phân chứa trọng số LoRA đã huấn luyện.
  - Đây là phần adapter nhỏ hơn nhiều so với full model.
  - Khi load với `PeftModel.from_pretrained`, sẽ ghép vào model gốc.

- `chat_template.jinja`
  - Template ChatML dùng để xây dựng prompt cho Qwen.
  - Chuyển list message `{role, content}` thành chuỗi `system/user/assistant` với token đặc biệt.
  - Có hỗ trợ thêm prompt cho model bắt đầu generation.

- `tokenizer_config.json`
  - Cấu hình tokenizer cho mô hình Qwen2.
  - Định nghĩa `tokenizer_class`, `eos_token`, `pad_token`, `model_max_length`.
  - `model_max_length` trong file này là `32768`.

- `tokenizer.json`
  - Dữ liệu tokenizer BPE (Byte Pair Encoding) của Qwen.
  - Dùng để token hóa prompt và giải mã output.
  - File root thường không ép `truncation`/`padding` cứng.

- `qwen_lora_finetune_vi_optimized.ipynb`
  - Notebook chính cho pipeline fine-tune trên Google Colab.
  - Bao gồm: cài đặt thư viện, phân tích dữ liệu, tokenize, load model, huấn luyện, đánh giá, inference và lưu adapter.

- `data_analysis.png`, `token_analysis.png`, `training_curves.png`, `summary_dashboard.png`
  - Các ảnh xuất ra từ notebook để minh hoạ dữ liệu, độ dài token, loss/perplexity và kết quả tổng kết.

## Luồng hoạt động hệ thống

1. Chuẩn bị dữ liệu chat
   - Dữ liệu dạng JSON list các conversation.
   - Mỗi item chứa `messages`, mỗi message có `role` và `content`.
   - Mẫu dữ liệu phù hợp với ChatML của Qwen.

2. Biến đổi thành prompt ChatML
   - Dùng `chat_template.jinja` hoặc `tokenizer.apply_chat_template` để tạo chuỗi đầu vào.
   - Template sẽ ghép các role `system`, `user`, `assistant` thành format:
     - `<|im_start|>system...<|im_end|>`
     - `<|im_start|>user...<|im_end|>`
     - `<|im_start|>assistant...<|im_end|>`

3. Token hóa với tokenizer Qwen
   - Load tokenizer từ `Qwen/Qwen2-1.5B` hoặc từ `tokenizer.json`/`tokenizer_config.json`.
   - Nếu tokenizer không có `pad_token`, gán `pad_token = eos_token`.
   - Chuẩn bị `input_ids`, `attention_mask`, và có thể dùng `max_length` thủ công.

4. Load base model và adapter LoRA
   - Load base model: `AutoModelForCausalLM.from_pretrained(BASE_MODEL)`.
   - Load adapter: `PeftModel.from_pretrained(model, ADAPTER_DIR)`.
   - Sau khi load, model hoạt động với trọng số gốc + hiệu chỉnh adapter.

5. Fine-tune hoặc inference
   - Fine-tune adapter trên nhiệm vụ `CAUSAL_LM` với dataset tiếng Việt.
   - Trong training, chỉ cập nhật trọng số LoRA, không cập nhật toàn bộ model.
   - Khi inference, dùng `model.generate(...)` và decode kết quả.

6. Lưu adapter và tái sử dụng
   - Kết quả huấn luyện lưu dưới dạng LoRA adapter.
   - Để sử dụng lại, chỉ cần load base model và `PeftModel.from_pretrained` với thư mục adapter.

## Ý nghĩa kỹ thuật của LoRA ở đây

- LoRA lưu bổ sung một số ma trận `low-rank` thay vì update toàn bộ mô hình.
- Giảm dung lượng lưu trữ và yêu cầu VRAM khi fine-tune.
- `target_modules` của Qwen là 4 module projection: `q_proj`, `k_proj`, `v_proj`, `o_proj`.
- Đây là cấu hình phổ biến để fine-tune mô hình causal/chat.

## Phân tích chi tiết file quan trọng

### adapter_config.json

Các giá trị chính:
- `r`: 8
- `lora_alpha`: 16
- `lora_dropout`: 0.05
- `target_modules`: ["o_proj", "q_proj", "k_proj", "v_proj"]
- `task_type`: `CAUSAL_LM`
- `inference_mode`: true

Nói cách khác, adapter được tạo để sử dụng ngay cả khi inference, không cần train lại mỗi lần load.

### chat_template.jinja

Template này là điểm nối giữa dữ liệu hội thoại JSON và input của model. Nếu không dùng built-in `tokenizer.apply_chat_template`, bạn có thể tự render template này với Jinja2.

### tokenizer.json / tokenizer_config.json

- `eos_token`: `<|endoftext|>`
- `pad_token`: `<|endoftext|>`
- `model_max_length`: 32768
- `tokenizer_class`: `Qwen2Tokenizer`

Lưu ý: tokenizer root không ép `truncation` tự động. Khi chạy inference hoặc training, nên chỉ định `max_length` và `padding` rõ ràng nếu cần.

## Cách sử dụng nhanh

```python
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel
import torch

BASE_MODEL = "Qwen/Qwen2-1.5B"
ADAPTER_DIR = "./"

# Load tokenizer
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=True)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

# Load base model
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    device_map="auto",
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
)

# Load LoRA adapter
model = PeftModel.from_pretrained(model, ADAPTER_DIR)
model.eval()

# Build prompt
messages = [
    {"role": "system", "content": "Ban la tro ly AI huu ich, tra loi bang tieng Viet."},
    {"role": "user", "content": "Giai thich ngan gon ve LoRA."},
]

prompt = tokenizer.apply_chat_template(
    messages, tokenize=False, add_generation_prompt=True
)
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

# Generate
with torch.no_grad():
    outputs = model.generate(
        **inputs,
        max_new_tokens=256,
        temperature=0.7,
        top_p=0.9,
        do_sample=True,
        pad_token_id=tokenizer.pad_token_id,
        eos_token_id=tokenizer.eos_token_id,
    )

result = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
print(result)
```

## Tiếp tục fine-tune từ checkpoint

Nếu có checkpoint huấn luyện còn giữ lại trạng thái optimizer, bạn có thể tiếp tục bằng:

```python
trainer.train(resume_from_checkpoint="./checkpoint-2544")
```

## Nội dung chính của notebook

Notebook `qwen_lora_finetune_vi_optimized.ipynb` thực hiện các phase sau:
1. Cài đặt thư viện và kiểm tra GPU
2. Tải và phân tích dữ liệu đầu vào
3. Tokenize và chuẩn bị dataset train/validation
4. Load base model và cấu hình LoRA
5. Huấn luyện adapter
6. Đánh giá loss và perplexity
7. Inference thử nghiệm
8. Lưu adapter và xuất dashboard tổng kết

## Lưu ý về tài nguyên

- Base model tải từ Hugging Face.
- Inference tốt nhất chạy trên GPU.
- Với GPU T4 16GB, model 1.5B có thể chạy được nếu dùng mixed precision / 8-bit.

## Giấy phép

Tương thích theo giấy phép của base model và dữ liệu huấn luyện.
