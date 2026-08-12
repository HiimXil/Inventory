# Feature Specification: Module web d'inventaire de stock par dépôt

**Feature Branch**: `001-module-inventaire-sqp-impression-uv`

**Created**: 2026-07-01

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## Clarifications

### Session 2026-07-24

- Q: Comment la complétude de l'import du stock théorique est-elle validée en mode fichier (FR-029) ? → A: Le fichier est intégralement parsé et validé (colonnes requises présentes, au moins une ligne, codes articles non vides et uniques, quantités entières ≥ 0) ; la règle d'exhaustivité par épuisement de la pagination ne s'applique plus au mode fichier et reste réservée au futur mode API.
- Q: La préparation de session exige-t-elle toujours une connexion à un service ARTIS distant (FR-024) ? → A: Non. En mode fichier, la préparation exige le réseau (elle est servie par le serveur applicatif) mais ne dépend d'aucun service externe ARTIS. Seul le comptage reste hors ligne — cela ne change pas.
- Q: Quelle colonne de l'export ARTIS alimente le stock théorique importé ? → A: « Stock physique », jamais « Qté théorique » (nette des réservations, ce qui produirait de faux écarts sur les articles réservés mais physiquement présents).
- Q: Comment le dépôt d'un import fichier est-il déterminé, sachant que le fichier ne porte aucune information de dépôt ? → A: Il est sélectionné explicitement par l'utilisateur au moment de l'import.
- Q: Le mode API ARTIS (ArtisHttpAdapter) est-il implémenté ? → A: Non — il reste une option non implémentée ; le mode fichier (ArtisFileAdapter) est la voie principale actuellement en service.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Préparer une session d'inventaire (Priority: P1)

En tant que responsable de dépôt, je sélectionne un dépôt, j'importe le stock théorique ARTIS à l'instant T, et je génère une session téléchargée sur l'appareil pour usage hors ligne.

**Why this priority**: Cette préparation est la base de toute opération d'inventaire, et elle conditionne la capacité à compter sans réseau.

**Independent Test**: Une session peut être créée à partir d'un dépôt avec un théorique chargé et un instant T figé, puis utilisée hors ligne sans autre dépendance. La session et la file des comptages sont stockées localement dans IndexedDB.

**Acceptance Scenarios**:

1. **Given** un utilisateur responsable de dépôt connecté avec droits suffisants, **When** il sélectionne un dépôt et l'import du stock théorique depuis ARTIS aboutit complètement et est validé, **Then** une session unique est créée, liée à l'appareil courant, avec un instant T figé et le théorique mis en cache local.
2. **Given** un utilisateur en cours de préparation d'une session, **When** l'import du stock théorique échoue pour n'importe quel motif — en mode fichier (voie principale) : fichier invalide ou non-.xlsx, colonnes requises manquantes, fichier vide, code article vide ou dupliqué, quantité négative ou non entière ; ou, pour le futur mode API : erreur réseau, timeout, erreur ARTIS HTTP 5xx, réponse malformée, ou pagination incomplète —, **Then** AUCUNE session n'est créée, une erreur explicite décrivant la cause est affichée, et un bouton de retry est proposé. (lié à FR-021, FR-022, FR-023, FR-029, FR-033, FR-034)
3. **Given** un dépôt avec une session active, **When** un nouvel inventaire est tenté pour ce même dépôt, **Then** le système refuse la création d'une seconde session active.
4. **Given** une session créée par un responsable ou un administrateur, **When** l'utilisateur met le comptage en pause, **Then** il peut le reprendre hors ligne sur le même appareil tant que la session n'est pas clôturée.
5. **Given** une session préparée avec théorique téléchargé et valide, **When** l'appareil perd la connexion, **Then** le comptage peut continuer à partir du cache local sans interruption.

---

### User Story 2 - Compter par scan, hors ligne (Priority: P1)

En tant que collaborateur logistique, je scanne les QR codes des produits et les quantités s'incrémentent automatiquement, même sans réseau.

**Why this priority**: C'est le cœur du flux opérationnel et l'objectif principal de remplacement du comptage manuel.

**Independent Test**: Un utilisateur peut scanner un code QR, voir la quantité augmenter et conserver le comptage localement même sans réseau.

**Acceptance Scenarios**:

1. **Given** une session active avec stock théorique chargé, **When** l'utilisateur scanne un QR code correspondant à un article du théorique, **Then** la quantité comptée pour cet article augmente immédiatement et localement.
2. **Given** une session active hors ligne, **When** l'utilisateur scanne un code inconnu ou absent du théorique, **Then** le système crée une ligne hors référentiel avec une quantité comptée et un théorique de 0, et signale distinctement l'anomalie.
3. **Given** une session active, **When** l'utilisateur ajoute ou corrige une quantité manuellement, **Then** la quantité comptée est définie à une valeur entière ≥ 0, la correction est tracée, et l'état local est mis à jour immédiatement.
4. **Given** une session préalablement bootstrappée (snapshot téléchargé), **When** l'utilisateur navigue vers `/sessions/[id]/count` hors ligne, **Then** la route se charge et l'interface de comptage est pleinement fonctionnelle sans redirection vers une page d'authentification (lié à FR-026).

---

### User Story 3 - Visualiser les écarts (Priority: P1)

En tant que collaborateur ou responsable, je vois instantanément l'écart entre stock théorique et stock compté.

**Why this priority**: La valeur métier du comptage dépend de la visibilité immédiate des écarts et de la lisibilité de la différence.

**Independent Test**: À partir d'un théorique et d'un comptage local, le système affiche un état conforme ou en écart par article.

**Acceptance Scenarios**:

1. **Given** une session active avec un article ayant une quantité comptée égale au théorique, **When** l'utilisateur consulte la vue de session, **Then** l'article est signalé comme conforme.
2. **Given** une session active avec un article ayant une quantité comptée différente du théorique, **When** l'utilisateur consulte la vue de session, **Then** l'écart est affiché clairement et mis en évidence en rouge.
3. **Given** une session active hors ligne, **When** l'utilisateur consulte les écarts, **Then** les calculs sont disponibles à partir des données locales sans dépendre du réseau.
4. **Given** un article, **When** le système calcule l'écart, **Then** il le détermine comme quantité comptée − stock théorique.

---

### User Story 4 - Synchroniser au retour du réseau (Priority: P2)

En tant que collaborateur, quand mon appareil retrouve le réseau, ma session se synchronise vers le serveur sans perte.

**Why this priority**: La synchronisation garantit la continuité et la traçabilité des sessions après le comptage hors ligne.

**Independent Test**: Une session comptée localement peut être envoyée au serveur après retour du réseau avec un mécanisme de reprise en cas d'échec.

**Acceptance Scenarios**:

1. **Given** une session localement complétée, **When** l'appareil repasse en ligne, **Then** les comptages sont envoyés au serveur et une confirmation visuelle de synchronisation réussie est affichée.
2. **Given** une synchronisation qui échoue, **When** l'utilisateur revient à la session, **Then** le système permet un nouveau rejeu et conserve les données locales jusqu'à réussite.
3. **Given** plusieurs mises à jour de la même session, **When** la synchronisation est traitée, **Then** la stratégie last-write-wins par session est appliquée.
4. **Given** une tentative de sync, **When** le client envoie `{ clientUpdatedAt, lines }` à `POST /api/sessions/[id]/sync`, **Then** le serveur applique last-write-wins en comparant `clientUpdatedAt` au `syncedAt` serveur, l'opération est idempotente et, en cas de 401, le client conserve `dirty=true`, invite à la réauthentification, puis rejoue le sync sans perte (lié à FR-030).

---

### User Story 5 - Clôturer et exporter (Priority: P2)

En tant que responsable de dépôt, je valide la session et j'obtiens une fiche de sortie exploitable pour la ressaisie manuelle dans ARTIS.

**Why this priority**: La clôture et l'export convertissent le comptage en livrable opérationnel pour les équipes.

**Independent Test**: Une session peut être clôturée et exportée vers un fichier Excel avec une feuille dédiée aux écarts.

**Acceptance Scenarios**:

1. **Given** une session ayant été synchronisée avec succès (statut SYNCED), **When** le responsable clôture la session, **Then** la session passe à l'état clôturé, devient verrouillée en lecture seule et ne peut plus être modifiée par l'utilisateur courant. La clôture et l'export sont des opérations en ligne postérieures à un sync réussi.
2. **Given** une session clôturée, **When** l'utilisateur exporte les résultats, **Then** un fichier Excel est généré avec dépôt, référence, désignation, stock théorique, stock compté, écart, et une feuille dédiée aux écarts uniquement.
3. **Given** des valeurs en écart, **When** l'export est généré, **Then** ces lignes sont identifiables visuellement et prêtes pour la ressaisie manuelle.
4. **Given** une exportation, **When** le fichier est nommé, **Then** il suit le format inventaire*{depot}*{AAAAMMJJ-HHmm}.xlsx.

---

### User Story 6 - Administrer (Priority: P3)

En tant qu'administrateur, je contrôle la création et l'annulation des inventaires et la gestion des accès.

**Why this priority**: L'administration garantit la sécurité, la conformité et la traçabilité du dispositif sans être l'objectif principal du parcours utilisateur quotidien.

**Independent Test**: Un administrateur peut gérer les rôles, créer ou annuler des sessions et consulter le journal d'audit.

**Acceptance Scenarios**:

1. **Given** un utilisateur avec le rôle Administrateur, **When** il accède à l'administration, **Then** il peut créer des sessions, annuler les sessions non clôturées et gérer les accès selon les rôles définis.
2. **Given** un utilisateur avec le rôle Direction lecture seule, **When** il consulte les résultats, **Then** il peut visualiser les données sans pouvoir modifier la session.
3. **Given** une session clôturée, **When** l'utilisateur tente une modification, **Then** la session est verrouillée en lecture seule et l'interface indique qu'elle est archivée.
4. **Given** toute action sensible, **When** elle est exécutée, **Then** un événement est journalisé avec horodatage, utilisateur et détail de l'action.
5. **Given** un utilisateur avec le rôle Direction lecture seule, **When** il tente d'exécuter une action de mutation (préparer, compter, synchroniser, clôturer, annuler), **Then** l'action est refusée et l'événement est journalisé (lié à FR-027, FR-032).
6. **Given** une tentative de modification ou suppression d'une entrée d'audit, **When** elle est effectuée, **Then** l'opération est refusée et l'événement de tentative est enregistré dans le journal d'audit (lié à FR-032).

---

### Edge Cases

- Que se passe-t-il si l'import ARTIS échoue lors de la préparation d'une session ? Aucune session n'est créée, une erreur explicite est affichée, et un retry est proposé.
- Que se passe-t-il si le théorique importé est vide ou incomplet ? La préparation est refusée avec un message explicite ; l'utilisateur peut relancer l'import.
- Que se passe-t-il si un appareil perd la connexion pendant le comptage ? Le système doit continuer à fonctionner localement et reprendre la synchronisation dès retour du réseau.
- Que se passe-t-il si un QR ne correspond pas à un article du théorique ? L'application signale l'article inconnu et conserve l'événement localement.
- Que se passe-t-il si une synchronisation échoue plusieurs fois ? Les données restent disponibles localement avec possibilité de retry.
- Que se passe-t-il si une session est annulée après avoir commencé à être comptée ? L'action est journalisée et l'état de session est rendu cohérent.
- Que se passe-t-il si un utilisateur sans droit tente d'accéder à une fonction sensible ? L'accès est refusé et l'action est enregistrée.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST allow a responsible user to select a dépôt and import the theoretical stock from ARTIS at a fixed instant T for a new inventory session.
- **FR-002**: The system MUST create a single inventory session and persist its theoretical data and counting queue locally for offline use. The session is de facto single-device: its snapshot and counting queue live in one browser's IndexedDB, with no separate copy elsewhere, so no server-side device-identity check is required or performed. (An opaque device token that would warn — without blocking — on a second device was considered during US1 and deliberately not adopted: it adds privacy and fragility concerns without changing a constraint that IndexedDB locality already satisfies in practice. It remains an available hardening option if a real need for that signal emerges.)
- **FR-003**: The system MUST support offline counting by QR scan and increment the counted quantity immediately and locally.
- **FR-004**: The system MUST allow manual addition and correction of counted quantities for any article in the session.
- **FR-005**: The system MUST display the current counted quantity and total counted quantity in real time during the session.
- **FR-006**: The system MUST calculate and display the gap between theoretical and counted stock per article, clearly marking differences as non-conformant and highlighting them in red.
- **FR-007**: The system MUST detect return to online connectivity and synchronize session data to the server without data loss.
- **FR-008**: The system MUST apply a last-write-wins policy per session during synchronization and allow retry after failure.
- **FR-009**: The system MUST allow a responsible user to close a session and export the results to Excel with a dedicated sheet for discrepancies only.
- **FR-010**: The system MUST provide role-based access control for Administrator, Responsable de dépôt, Collaborateur logistique, and Direction lecture seule.
- **FR-011**: The system MUST record audit events for session creation, counting actions (agrégés), synchronization, closure, cancellation, and access attempts with timestamp, actor, and action details.
- **FR-012**: The system MUST ensure that data is stored and hosted exclusively in the European Union and that HTTPS is enforced.
- **FR-013**: The system MUST be optimized for Chrome and Edge, with mobile and tablet usage prioritized.
- **FR-014**: The system MUST use QR codes containing article references already printed and must not include label generation in scope.
- **FR-015**: The system MUST expose a server-side integration boundary to ARTIS and must never expose ARTIS identifiers directly to the browser.
- **FR-016**: The system MUST allow only one active inventory session per dépôt at a time.
- **FR-017**: The system MUST permit only an Administrateur to cancel a non-closed session.
- **FR-018**: The system MUST purge the local IndexedDB cache of theoretical stock and counting queue after successful synchronization and confirmation of session closure.
- **FR-019**: The system MUST trace manual quantity corrections and store quantities as integers ≥ 0.
- **FR-020**: The system MUST persist the session's theoretical stock cache and the queue of counting operations in IndexedDB for offline continuity.
- **FR-021**: The system MUST require successful and complete validation of the theoretical stock import from ARTIS before creating an inventory session; session creation MUST NOT occur if the import fails, times out, or the theoretical stock is empty or incomplete.
- **FR-022**: The system MUST display explicit error messages and offer a retry option when ARTIS import fails due to network error, timeout, or ARTIS error; no partial session MUST be persisted.
- **FR-023**: The system MUST validate that the imported theoretical stock is complete and non-empty before proceeding to session creation; if validation fails, the preparation MUST be refused with a message indicating incompleteness.
- **FR-024**: The system MUST require network connectivity for session preparation, since preparation is served by the application server; in file mode, preparation does not depend on any external ARTIS service. Only the counting phase operates offline — this remains unchanged.
- **FR-025**: The system MUST retain closed inventory sessions and audit events for 24 months, then automatically purge data beyond this retention period in compliance with RGPD.
 - **FR-026**: The route `/sessions/[id]/count` DOIT être accessible et pleinement fonctionnelle hors ligne SANS aucune redirection serveur (par ex. vers `/login`). L'authentification n'est imposée qu'aux frontières serveur (`/bootstrap`, `/sync`), jamais en garde de rendu/redirection sur cette route. Un test E2E Playwright (réseau désactivé) DOIT vérifier que la route se charge sans redirection.
 - **FR-027**: L'autorisation RBAC DOIT être appliquée CÔTÉ SERVEUR sur chaque server action et chaque route handler individuellement (pas uniquement via le middleware). Toute tentative non autorisée DOIT être refusée et journalisée.
 - **FR-028**: Les endpoints `GET /api/sessions/[id]/bootstrap` et `POST /api/sessions/[id]/sync` DOIVENT authentifier l'appelant et vérifier son autorisation RBAC avant de renvoyer ou d'accepter la moindre donnée de session.
 - **FR-029**: En mode fichier (voie principale d'import du stock théorique ARTIS), l'import n'est considéré complet que si le fichier est intégralement parsé et validé : les colonnes requises sont présentes, le fichier contient au moins une ligne, les codes articles sont non vides et uniques, et les quantités sont des entiers ≥ 0. Si une condition échoue, aucune session n'est créée (lié à FR-021/023). La règle d'exhaustivité par épuisement de la pagination (l'import DOIT agréger l'intégralité des pages avant validation, et la réponse agrégée DOIT passer la validation Zod avec tous les champs requis présents et au moins une ligne) reste réservée au futur mode API.
 - **FR-030**: `POST /api/sessions/[id]/sync` DOIT être idempotent (renvoyer le même état serveur pour un même payload). Le last-write-wins DOIT être résolu en comparant le `clientUpdatedAt` du client au `syncedAt` stocké côté serveur ; le plus récent l'emporte. En cas d'échec d'authentification (HTTP 401) pendant le sync, les données locales DOIVENT être conservées (`dirty`), l'utilisateur invité à se réauthentifier, puis le sync rejoué, sans perte de comptage.
 - **FR-031**: Une session DOIT atteindre le statut `SYNCED` (synchronisation acceptée par le serveur) avant de pouvoir être clôturée ; la clôture DOIT rejeter toute session non `SYNCED`. L'export DOIT exiger un statut ∈ {`SYNCED`, `CLOSED`}.
 - **FR-032**: Le journal d'audit DOIT être append-only et immuable ; toute tentative de modification ou de suppression d'une entrée DOIT être refusée et elle-même journalisée.
 - **FR-033**: En mode fichier, le stock théorique importé DOIT correspondre à la colonne « Stock physique » de l'export ARTIS, et non à « Qté théorique » (qui est nette des réservations et produirait de faux écarts sur les articles réservés mais physiquement présents).
 - **FR-034**: En mode fichier, le dépôt DOIT être sélectionné explicitement par l'utilisateur lors de l'import ; le fichier importé ne porte aucune information de dépôt et ne peut donc pas servir à le déterminer.

## RBAC Matrix

Actions × rôles :
- **Préparer (import ARTIS)** : ADMIN, DEPOT_MANAGER
- **Compter (scan/manuel)** : ADMIN, DEPOT_MANAGER, LOGISTICS
- **Synchroniser** : ADMIN, DEPOT_MANAGER, LOGISTICS
- **Clôturer** : ADMIN, DEPOT_MANAGER
- **Exporter/télécharger** : ADMIN, DEPOT_MANAGER, DIRECTION
- **Annuler une session** : ADMIN
- **Gérer les utilisateurs** : ADMIN
- **Consulter l'audit** : ADMIN
- **Consulter les résultats** : ADMIN, DEPOT_MANAGER, LOGISTICS (sa session), DIRECTION

### Key Entities _(include if feature involves data)_

- **InventorySession**: Represents a single counting session for one dépôt, one device, one fixed instant T, and one set of theoretical stock data.
- **InventoryLine**: Represents one article within a session with theoretical quantity, counted quantity, discrepancy, and status (conform / gap).
- **User**: Represents an authenticated user with a role and access rights for inventory operations.
- **AuditEvent**: Represents an immutable event recording who performed which action and when.
- **SynchronizationPayload**: Represents the local session state sent to the server when the device is online.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can prepare a session, count offline, and close it without requiring network connectivity during the counting phase in at least 95% of test runs.
- **SC-002**: The system records and displays discrepancies correctly for every scanned or manually updated line in end-to-end test scenarios.
- **SC-003**: At least 90% of users complete the primary counting flow from session start to export without assistance in usability validation.
- **SC-004**: All inventory sessions produce an auditable trail for creation, counting, closure, and cancellation actions.

## Assumptions

- Users operate on modern Chrome or Edge browsers with access to device camera support for QR scanning.
- The application will rely on a server-side ARTIS adapter and a local offline store for counting sessions.
- The theoretical stock and article reference data are available from ARTIS at session preparation time.
- The file mode (ArtisFileAdapter, import of a client-provided ARTIS Excel export) is the primary implemented import path. The API mode (ArtisHttpAdapter, direct calls to the live ARTIS API) remains an unimplemented option for future use.
- The initial scope covers counting, discrepancy display, synchronization, closure, export, and administration; label generation is out of scope.
