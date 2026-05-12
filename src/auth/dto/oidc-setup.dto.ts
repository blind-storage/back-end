import { ApiProperty } from '@nestjs/swagger';

export class OidcSetupDto {
  @ApiProperty({ description: 'Token de configuration temporaire reçu après le callback OIDC' })
  setup_token!: string;

  @ApiProperty({ example: 'alice42' })
  username!: string;

  @ApiProperty({ description: 'Hash du mot de passe maître (dérivé côté client)' })
  auth_hash!: string;

  @ApiProperty({ description: 'Clé publique' })
  pub_key!: string;

  @ApiProperty({ description: 'Clé privée chiffrée (dérivée du mot de passe maître)' })
  priv_key_enc_1!: string;

  @ApiProperty({ description: 'Clé privée chiffrée (dérivée du code de récupération)' })
  priv_key_enc_2!: string;

  @ApiProperty({ description: 'Salt pour la dérivation du mot de passe maître' })
  salt_mp!: string;

  @ApiProperty({ description: 'Salt pour la dérivation du code de récupération' })
  salt_rc!: string;

  @ApiProperty({ description: "Clé de chiffrement pour l'arborescence" })
  tree_enc_key!: string;
}
