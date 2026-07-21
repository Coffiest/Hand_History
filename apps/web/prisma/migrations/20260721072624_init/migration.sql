-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heroPosition" TEXT,
    "numPlayers" INTEGER,
    "smallBlind" INTEGER,
    "bigBlind" INTEGER,
    "potTotal" INTEGER,
    "resultAmount" INTEGER,
    "wonByFold" BOOLEAN,
    "notes" TEXT,
    "shareToken" TEXT,

    CONSTRAINT "Hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandCard" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "boardStreet" TEXT,
    "position" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "suit" TEXT NOT NULL,
    "rankConfidence" DOUBLE PRECISION,
    "suitConfidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'recognized',

    CONSTRAINT "HandCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandAction" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "street" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toAmount" INTEGER,
    "actorLabel" TEXT NOT NULL DEFAULT 'Hero',

    CONSTRAINT "HandAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authId_key" ON "User"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Hand_shareToken_key" ON "Hand"("shareToken");

-- CreateIndex
CREATE INDEX "Hand_userId_createdAt_idx" ON "Hand"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HandCard_handId_idx" ON "HandCard"("handId");

-- CreateIndex
CREATE INDEX "HandAction_handId_sequenceNumber_idx" ON "HandAction"("handId", "sequenceNumber");

-- AddForeignKey
ALTER TABLE "Hand" ADD CONSTRAINT "Hand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandCard" ADD CONSTRAINT "HandCard_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandAction" ADD CONSTRAINT "HandAction_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
