-- CreateTable
CREATE TABLE "local_credential" (
    "employee_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT,
    "setup_token_hash" TEXT,
    "setup_expires_at" TIMESTAMP(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_credential_pkey" PRIMARY KEY ("employee_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_credential_username_key" ON "local_credential"("username");

-- CreateIndex
CREATE UNIQUE INDEX "local_credential_setup_token_hash_key" ON "local_credential"("setup_token_hash");

-- AddForeignKey
ALTER TABLE "local_credential" ADD CONSTRAINT "local_credential_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written rules (docs/09 §7)
ALTER TABLE "local_credential"
  ADD CONSTRAINT "local_credential_username_format" CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  ADD CONSTRAINT "local_credential_hash_format" CHECK (password_hash IS NULL OR password_hash LIKE 'scrypt$%'),
  ADD CONSTRAINT "local_credential_setup_pair" CHECK ((setup_token_hash IS NULL) = (setup_expires_at IS NULL)),
  ADD CONSTRAINT "local_credential_attempts_valid" CHECK (failed_attempts >= 0);
