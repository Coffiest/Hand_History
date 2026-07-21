# デプロイ手順

構成: **Vercel(Web)** + **Fly.io(認識サービス)** + **Supabase(Postgres / Auth)**
(Meta-GEO と同じパターン)。

## 0. 前提

- Supabase プロジェクト、Vercel アカウント、Fly.io アカウントを用意する。
- カード認識モデルは `services/recognition/models/` にコミット済み（`suit_cnn.pth`,
  `rank_multiscan_hog_svm_v2.joblib`）。

## 1. Supabase（DB + Auth）

1. 新規プロジェクトを作成し、接続文字列（`DATABASE_URL`）を取得する。
2. Auth → Providers で **Google** と **Apple** を有効化する
   （Apple は Apple Developer 側で Services ID / ドメイン検証の設定が必要）。
3. マイグレーションを適用する:
   ```bash
   cd apps/web
   DATABASE_URL="<supabaseの接続文字列>" npx prisma migrate deploy
   ```

## 2. Fly.io（認識サービス）

Rank パイプラインは torch + sklearn モデルを常駐メモリに載せ、プロセスプールで
並列推論するため、サーバーレスではなく常駐マシンが必要。

```bash
cd services/recognition
fly launch --no-deploy          # 初回のみ（fly.toml は用意済み）
fly deploy
```

デプロイ後の内部URL（例 `https://handhistory-recognition.fly.dev`）を控える。

## 3. Vercel（Web）

1. リポジトリを Vercel にインポート（`vercel.json` によりモノレポの
   `apps/web` がビルドされる）。
2. 環境変数を設定:
   | 変数 | 値 |
   |---|---|
   | `DATABASE_URL` | Supabase の接続文字列 |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase の URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の anon key |
   | `RECOGNITION_SERVICE_URL` | Fly.io の認識サービスURL |
3. デプロイ（以降 `main` への push で自動デプロイ）。

## ローカル開発

```bash
# DB + 認識サービス + Web をまとめて
docker compose up

# または個別に:
#  1) Postgres を起動し migrate
cd apps/web && DATABASE_URL=... npx prisma migrate dev
#  2) 認識サービス
cd services/recognition && pip install -r requirements.txt && \
  uvicorn app.main:app --port 8080
#  3) Web（別ターミナル）
cd apps/web && \
  DATABASE_URL=... RECOGNITION_SERVICE_URL=http://localhost:8080 ALLOW_DEV_USER=1 \
  pnpm dev
```

`ALLOW_DEV_USER=1`（本番では無効）は、Supabase 未設定でもログインなしで
動作確認できる開発用フォールバック。

## この環境で未検証の項目

- **実カード写真での認識精度**: 実物のトランプ画像が無いため、パイプラインが
  エラーなく端から端まで動くことのみ確認済み（合成画像でスモークテスト）。
  精度は実機のカメラ + 実カードで要確認。
- **Google / Apple OAuth の実ログイン**: 実クレデンシャルが無いため未検証
  （コードは実装済み。Supabase / Apple Developer 設定後に要確認）。
- **Docker イメージの実ビルド**: Docker-in-Docker 不可のため Dockerfile の
  実ビルドは未検証。
