-- 9.0 linked-characters DM: remembers which characters a member was already told about. Additive only.
CREATE TABLE "MemberLinkNotice" (
    "memberId" TEXT NOT NULL,
    "characterIds" TEXT NOT NULL DEFAULT '',
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberLinkNotice_pkey" PRIMARY KEY ("memberId")
);
ALTER TABLE "MemberLinkNotice" ADD CONSTRAINT "MemberLinkNotice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
