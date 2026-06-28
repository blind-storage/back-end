ALTER TABLE "UserTree" DROP CONSTRAINT "UserTree_userId_fkey";
ALTER TABLE "UserTree"
ADD CONSTRAINT "UserTree_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "File" DROP CONSTRAINT "File_ownerId_fkey";
ALTER TABLE "File"
ADD CONSTRAINT "File_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FilePermission" DROP CONSTRAINT "FilePermission_fileId_fkey";
ALTER TABLE "FilePermission"
ADD CONSTRAINT "FilePermission_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FilePermission" DROP CONSTRAINT "FilePermission_userId_fkey";
ALTER TABLE "FilePermission"
ADD CONSTRAINT "FilePermission_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FilePermission" DROP CONSTRAINT "FilePermission_grantedById_fkey";
ALTER TABLE "FilePermission"
ADD CONSTRAINT "FilePermission_grantedById_fkey"
FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileVersion" DROP CONSTRAINT "FileVersion_fileId_fkey";
ALTER TABLE "FileVersion"
ADD CONSTRAINT "FileVersion_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FileVersion" DROP CONSTRAINT "FileVersion_editedById_fkey";
ALTER TABLE "FileVersion"
ADD CONSTRAINT "FileVersion_editedById_fkey"
FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
