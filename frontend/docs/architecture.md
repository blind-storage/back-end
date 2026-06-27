# Architecture du frontend

## Contraintes Next.js liées au Zero-Knowledge

Aucun secret (mot de passe maître, clé privée, KEK, FEK…) ne doit **jamais**
transiter par un serveur Next. En pratique :

- **App Router en mode 100 % client.** Les pages qui touchent à la crypto sont des
  Client Components (`'use client'`). Pas de Server Component manipulant un secret.
- **Pas de Route Handler Next** (`app/api/**`) pour l'authentification ou la
  crypto — le front parle **directement** au backend NestJS.
- **Recommandation : `output: 'export'` (static export).** L'app devient un bundle
  statique : il n'y a littéralement **aucun serveur Next** susceptible de fuiter un
  secret, ce qui rend le Zero-Knowledge structurellement vrai. La route
  `/callback` lit ses paramètres côté client (`useSearchParams`), donc le static
  export suffit.

> Si un besoin futur impose du SSR, il faudra cloisonner strictement : crypto et
> secrets confinés aux Client Components, jamais dans le rendu serveur.

---

## Arborescence cible

```
frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # accueil / redirection selon session
│   ├── register/page.tsx        # inscription locale
│   ├── login/page.tsx           # login local (+ étape TOTP)
│   ├── callback/page.tsx        # ⭐ OIDC : route selon ?token/?setup_token/?link_token
│   ├── recover/page.tsx         # récupération via code TOTP
│   └── (app)/                   # zone authentifiée
│       ├── vault/page.tsx       # fichiers (Phase 2 — placeholder)
│       └── settings/page.tsx    # providers OIDC liés, TOTP, mot de passe
│
├── lib/
│   ├── crypto/                  # ⭐ cœur ZK
│   │   ├── keys.ts              # RSA : génération, import/export, double usage OAEP+PSS
│   │   ├── kdf.ts              # Argon2id + HKDF (split auth_hash / KEK)
│   │   ├── symmetric.ts        # AES-GCM (FEK, TEK, enveloppe clé privée)
│   │   ├── signing.ts          # RSA-PSS sign/verify
│   │   └── account.ts          # bootstrapAccount(), unlock()
│   ├── api/                     # client REST typé
│   │   ├── client.ts           # fetch wrapper (base URL, Bearer, gestion erreurs)
│   │   ├── auth.ts             # endpoints /auth/*
│   │   └── users.ts            # endpoints /users/*
│   └── session/
│       └── store.ts            # JWT + clés déchiffrées (en mémoire)
│
└── components/                  # UI réutilisable (formulaires, QR code, etc.)
```

---

## Couche API (`lib/api/`)

- `client.ts` : un wrapper `fetch` avec `NEXT_PUBLIC_API_URL` comme base, injection
  automatique de `Authorization: Bearer <jwt>` quand une session existe, et
  normalisation des erreurs (`401/403/404/409`).
- Un module par domaine backend (`auth.ts`, `users.ts`) exposant des fonctions
  typées. Les types DTO peuvent être réimportés du package `@blind-storage/types`
  (le même que le backend) pour rester synchronisés.

---

## Gestion de session (`lib/session/`)

Principe : **les secrets vivent en mémoire uniquement**.

| Donnée | Stockage | Raison |
|---|---|---|
| JWT (`access_token`) | mémoire (store) | éviter le vol via XSS depuis `localStorage` |
| Clé privée déchiffrée (CryptoKey) | mémoire, **non extractible** si possible | ne doit jamais être persistée |
| TEK, clés dérivées | mémoire | idem |

**Conséquence assumée :** un rechargement de page perd la clé privée en mémoire →
l'utilisateur doit **re-saisir son MP** (ou se reconnecter). C'est le compromis
sûr par défaut.

> Alternative possible à discuter : conserver le JWT en `sessionStorage` pour
> éviter une reconnexion complète, tout en re-dérivant les clés à la demande
> (re-saisie du MP). À ne faire qu'après analyse du risque XSS.

---

## Variables d'environnement (front)

| Variable | Exemple | Rôle |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | base URL du backend NestJS |

Côté backend, penser à régler `FRONTEND_URL`, `SESSION_SECRET` et `JWT_SECRET`
(voir [../README.md](../README.md)).
