This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Nhận dạng giọng nói (chạy trên máy)

Phụ đề và timing karaoke được tạo từ audio của video, không dùng phụ đề YouTube:

1. Tải audio bằng `yt-dlp`.
2. Nhận dạng tiếng Nhật bằng **Apple SpeechAnalyzer** (macOS 26+, Neural Engine). Nếu không có hoặc lỗi thì dùng **Whisper** (whisper.cpp). Đặt `ASR_ENGINE=whisper` để luôn dùng Whisper.
3. Căn điểm bắt đầu của từng chữ theo **Silero VAD** (`models/silero_vad.onnx`) và bỏ các đoạn không có tiếng người.

Cài đặt trên macOS:

```bash
brew install yt-dlp ffmpeg whisper-cpp
curl -L -o models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

`bin/apple-asr` được build tự động từ `tools/apple-asr/main.swift` khi chạy `npm run dev` / `npm run build` (cần Xcode Command Line Tools), hoặc chạy `npm run build:asr`. Lần đầu dùng, macOS sẽ tải gói nhận dạng tiếng Nhật. Kết quả được cache trong `.cache/asr-v3/`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
