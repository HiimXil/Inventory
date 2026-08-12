<!-- Sync Impact Report
- Version change: 0.0.0 → 1.0.0
- Modified principles: New constitution created from template
- Added sections: Additional Constraints, Development Workflow
- Removed sections: None
- Templates requiring updates: .specify/templates/plan-template.md — ✅ no changes required; .specify/templates/spec-template.md — ✅ no changes required; .specify/templates/tasks-template.md — ✅ no changes required
- Follow-up TODOs: None
-->

# Module d'inventaire SQP IMPRESSION UV Constitution

## Core Principles

### I. Offline-First (NON-NEGOTIABLE)
Le module de comptage MUST fonctionner à 100 % sans réseau. Une session d'inventaire est mono-appareil : pas de synchronisation multi-appareils, pas de merge concurrent, et pas de mode de comptage dépendant d'une connexion permanente. Le stock théorique est téléchargé puis mis en cache local au démarrage de la session, le comptage s'effectue hors ligne, puis les résultats sont synchronisés au retour du réseau selon une stratégie last-write-wins par session. Toute fonctionnalité qui exige une synchronisation multi-appareils ou un état partagé entre appareils est hors périmètre et MUST être rejetée.

### II. ARTIS en lecture seule stricte
ARTIS est un système en lecture seule pour ce module. Aucune écriture dans ARTIS n'est autorisée depuis l'application. Toute intégration passe par un adaptateur côté serveur derrière une interface stable ; aucun appel direct depuis le navigateur n'est permis. Les identifiants ARTIS ne sont jamais exposés au navigateur. Un mock ARTIS conforme à cette interface est fourni pour le développement et les tests.

### III. Séparation des surfaces
La surface de comptage est un îlot client-side fonctionnant offline via IndexedDB. La préparation, l'administration, le proxy ARTIS, l'export et l'authentification sont rendus côté serveur. Le serveur est la seule frontière d'entrée vers ARTIS et les données de session. Aucune logique métier dépendante du réseau ne doit être embarquée côté client au-delà de l'état local de session.

### IV. Sécurité, confidentialité et traçabilité
L'accès est restreint à quatre rôles : Administrateur, Responsable de dépôt, Collaborateur logistique, Direction lecture seule. Les données sont hébergées et stockées exclusivement dans l'Union européenne, avec HTTPS obligatoire. Un journal d'audit horodaté enregistre la création, le comptage, la clôture et l'annulation des sessions avec qui, quand et quoi. La collecte et la conservation des données sont minimisées au strict nécessaire.

### V. Simplicité avant la complexité
Le système suit une architecture simple et déployable. Une seule base de données serveur est utilisée ; tout service supplémentaire doit être justifié par un besoin métier mesurable. Les solutions les plus simples, maintenables et testables sont privilégiées, et toute complexité additionnelle doit être explicitement documentée.

## Additional Constraints

Le projet MUST respecter la stack technique imposée : Next.js 15 avec App Router, TypeScript en mode strict, Tailwind CSS en approche mobile/tablette first, Prisma et PostgreSQL côté serveur, Dexie.js avec IndexedDB côté client, PWA via Serwist, scan QR via BarcodeDetector natif avec fallback vers @zxing/browser, Auth.js v5 avec comptes internes et mots de passe hachés en argon2, validation aux frontières avec Zod, export Excel via ExcelJS, et tests automatisés avec Vitest et Playwright.

Le comportement UX est défini de façon explicite : Chrome et Edge sont les cibles exclusives, le retour visuel au scan est immédiat, les écarts sont affichés comme conforme vs écart, et les valeurs en écart sont mises en évidence en rouge. Les QR codes contiennent déjà la référence article ; la génération d'étiquettes n'est pas dans le périmètre.

Les environnements de développement et de test MUST utiliser un mock ARTIS indépendant de l'API réelle, et toute évolution de contrat ou de schéma MUST être validée à la frontière avant intégration.

## Development Workflow

Tout changement MUST respecter la séparation entre client offline et services serveur, ainsi que la contrainte d'offline-first. Les flux critiques de comptage, de clôture et de synchronisation MUST être couverts par des tests automatisés avant mise en œuvre, avec des tests unitaires sur la logique métier, des tests d'intégration sur la persistance locale et les adaptateurs serveur, et des tests Playwright sur les parcours scan et clôture.

Les changements de schéma, de rôles, de validation ou d'interface ARTIS MUST être livrés avec les tests et la documentation associés dans la même évolution. Aucune évolution ne peut introduire un accès direct du client vers ARTIS ni un nouveau mode de synchronisation multi-appareils sans justification explicite et validation par la gouvernance du projet.

## Governance

Cette constitution prévaut sur toute autre pratique ou documentation contradictoire. Toute modification doit être documentée avec un raisonnement clair, un impact sur l'architecture et les tests, puis approuvée avant intégration. Les changements qui affectent l'offline-first, la frontière ARTIS, les rôles, la résidence des données ou la stratégie de test exigent une revue explicite.

Le versionnement suit le principe semver : les changements majeurs retirent ou redéfinissent des principes de gouvernance, les changements mineurs ajoutent ou développent un principe ou une section, et les correctifs apportent des clarifications non sémantiques. Chaque plan, spécification et liste de tâches MUST être vérifié contre cette constitution avant implémentation, et toute violation doit faire l'objet d'une exception formellement justifiée.

**Version**: 1.0.0 | **Ratified**: 2026-07-01 | **Last Amended**: 2026-07-01
