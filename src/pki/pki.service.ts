import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createSign, createHash } from 'crypto';
import { PrismaService } from '../prisma.service';

export interface BlindCertificate {
  version: 1;
  subject: { id: string; username: string; email: string };
  pub_key: string;
  fingerprint: string;
  issued_at: string;
  expires_at: string;
}

export interface CrlEntry {
  fingerprint: string;
  revoked_at: string;
  reason: string;
}

export interface BlindCrl {
  version: 1;
  issued_at: string;
  revoked: CrlEntry[];
}

@Injectable()
export class PkiService {
  private readonly logger = new Logger(PkiService.name);
  private readonly caPrivateKey: string;
  private readonly caPublicKey: string;

  constructor(private readonly prisma: PrismaService) {
    this.caPrivateKey = (process.env.CA_PRIVATE_KEY ?? '').replace(
      /\\n/g,
      '\n',
    );
    this.caPublicKey = (process.env.CA_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
    if (!this.caPrivateKey || !this.caPublicKey) {
      this.logger.warn(
        'CA_PRIVATE_KEY or CA_PUBLIC_KEY not set — PKI disabled',
      );
    } else {
      this.logger.log('PKI configured and active');
    }
  }

  isConfigured(): boolean {
    return !!this.caPrivateKey && !!this.caPublicKey;
  }

  computeFingerprint(pubKeyBase64: string): string {
    return createHash('sha256')
      .update(Buffer.from(pubKeyBase64, 'base64'))
      .digest('hex');
  }

  private sign(payload: string): string {
    const s = createSign('SHA256');
    s.update(payload);
    // ieee-p1363 = raw r||s (64 bytes for P-256), directly consumable by Web Crypto subtle.verify
    return s.sign(
      { key: this.caPrivateKey, dsaEncoding: 'ieee-p1363' },
      'base64',
    );
  }

  issueCertificate(subject: {
    id: string;
    username: string;
    email: string;
    pub_key: string;
  }): { cert: BlindCertificate; signature: string; fingerprint: string } {
    if (!this.isConfigured())
      throw new ServiceUnavailableException('PKI non configurée');

    const fingerprint = this.computeFingerprint(subject.pub_key);
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 2);

    const cert: BlindCertificate = {
      version: 1,
      subject: {
        id: subject.id,
        username: subject.username,
        email: subject.email,
      },
      pub_key: subject.pub_key,
      fingerprint,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const signature = this.sign(JSON.stringify(cert));
    this.logger.log(
      `Certificate issued for user: ${subject.id} (fp: ${fingerprint.slice(0, 16)}…)`,
    );
    return { cert, signature, fingerprint };
  }

  async revokeCertificate(fingerprint: string, reason: string): Promise<void> {
    await (this.prisma as any).revokedCertificate.upsert({
      where: { fingerprint },
      update: {},
      create: { fingerprint, reason },
    });
    this.logger.log(
      `Certificate revoked: ${fingerprint.slice(0, 16)}… (reason: ${reason})`,
    );
  }

  async getCrl(): Promise<{ crl: BlindCrl; signature: string }> {
    if (!this.isConfigured())
      throw new ServiceUnavailableException('PKI non configurée');

    const revoked = await (this.prisma as any).revokedCertificate.findMany({
      orderBy: { revokedAt: 'asc' },
    });

    const crl: BlindCrl = {
      version: 1,
      issued_at: new Date().toISOString(),
      revoked: revoked.map((r: any) => ({
        fingerprint: r.fingerprint,
        revoked_at: r.revokedAt.toISOString(),
        reason: r.reason,
      })),
    };

    const signature = this.sign(JSON.stringify(crl));
    return { crl, signature };
  }

  getCaPublicKey(): string {
    return this.caPublicKey;
  }
}
