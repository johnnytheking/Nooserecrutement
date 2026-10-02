# NOOSE · Portail interne

Portail de recrutement, d’administration et de formation pour Unity RP. Interface bleu nuit et anthracite, accents rouges, logo NOOSE original avec transparence conservée. Le bandeau institutionnel et la connexion compacte reprennent la direction visuelle convenue. Ce portail appartient à un univers fictif ; il n’est pas affilié au DHS réel.

## Fonctions

- Connexion avec identifiant et mot de passe, sessions de 12 heures et déconnexion.
- Trois rôles : administrateur, recruteur et formateur.
- Registre des recrutements : identité RP, numéro unique, matricule, unité, grade, responsable, notes et statut.
- Fiches `[NUMÉRO] — [PRÉNOM NOM]`, recherche et filtres, archivage par changement de statut.
- Contrats et pièces jointes PDF, PNG et JPEG, 8 Mo par fichier. Les contrats peuvent contenir deux pages dans un PDF, ou être ajoutés sous forme de deux images.
- Catégories : contrat, portrait, identité RP, permis RP et autre pièce ; validation, correction demandée et téléchargement.
- Dix questions d’entretien initiales, réponse du candidat, critères attendus, exactitude, appréciation de 1 à 5, total et avis général.
- Parcours configurable et historique des évaluations. Les tests hebdomadaires restent consultables séparément et sont signalés à renouveler après sept jours.
- Gestion des comptes, questions et étapes depuis l’administration ; journal des actions.
- Interface adaptée au téléphone et au PC.

Le programme initial reprend les intitulés disponibles : sacramentum, contrat signé et validé, formation générale et introductive, visite médicale, évaluation d’aptitude, test d’aptitude hebdomadaire. Les intitulés détaillés supplémentaires pourront être ajoutés dans Administration → Parcours et formations.

## Accès

En développement local, le premier compte est `admin` avec le code demandé `1970`, si `ADMIN_PASSWORD` n’est pas renseigné. En production, le secret `ADMIN_PASSWORD` est obligatoire au premier démarrage et devra être réglé sur le code choisi dans Render. Les mots de passe sont hachés avec scrypt avant leur insertion en base. La variable initialise uniquement le premier compte : elle ne réinitialise pas un compte déjà existant.

Les nouveaux comptes se créent dans Administration → Comptes et accès. Ils demandent un mot de passe d’au moins huit caractères. La désactivation d’un compte révoque ses sessions. Le formateur accède au parcours et aux évaluations, sans accès aux entretiens, pièces jointes, téléphones ni informations administratives détaillées. Les étapes administratives sont réservées aux recruteurs et administrateurs.

## Démarrage local

Node.js 24 est requis.

```bash
npm ci
npm run dev
```

Le portail est servi sur `http://localhost:4173`. Sans `DATABASE_URL`, les données locales sont conservées dans `.data/noose.sqlite`. Ce dossier est exclu de Git et de l’archive de livraison. `npm run build` compile l’interface ; `npm start` la sert avec l’API.

## Mise en ligne sur Render

1. Placer le contenu de ce dossier à la racine d’un dépôt GitHub, GitLab ou Bitbucket ; ne pas publier `.env` ou `.data`.
2. Dans Render, sélectionner le workspace confirmé et créer un Blueprint depuis ce dépôt.
3. Le fichier `render.yaml` définit un service web et une base PostgreSQL dans la région Francfort, avec accès externe à la base désactivé.
4. Renseigner le secret `ADMIN_PASSWORD` avec le code administrateur choisi, puis appliquer le Blueprint.
5. Render relie automatiquement `DATABASE_URL` à la connexion interne PostgreSQL. En production, l’application refuse de démarrer sans cette base pour éviter d’enregistrer les dossiers sur un disque temporaire.
6. Vérifier que le service est `live`, que `/healthz` répond correctement et que la connexion fonctionne sur l’adresse `.onrender.com` attribuée par Render.

Le nom d’hôte exact est attribué lors de la création du service. Aucune adresse publique n’a été réservée dans cette archive.

### Gratuité et conservation

Le Blueprint sélectionne les ressources **gratuites d’essai** et n’engage aucun plan payant. Un service web gratuit s’endort après 15 minutes sans trafic et son redémarrage peut prendre environ une minute. **La base PostgreSQL gratuite Render expire après 30 jours** : elle doit être migrée ou passée sur un plan durable avant cette échéance. Ce modèle gratuit n’est donc pas une solution permanente sans intervention. Voir https://render.com/docs/free.

Comptes, sessions, dossiers, entretiens, validations, historique et contenu des fichiers sont conservés dans PostgreSQL. Aucun document envoyé n’est stocké uniquement sur le disque éphémère du service. Le plafond documentaire global de cette version est fixé à 250 Mo. Pour un usage pérenne, choisir une base durable et configurer ses sauvegardes ; ces ressources ne sont pas provisionnées sans accord.

## Vérifications

```bash
npm test
npm run build
```

Le test d’intégration utilise une base SQLite temporaire et un serveur isolé. Il vérifie notamment : connexion et échec de connexion, cookies, CSRF et origine, création de dossier, unicité du numéro, conflits de modification, notation d’entretien, rôles, validations, fichiers, refus de faux fichiers, désactivation de compte, journal, déconnexion et conservation après redémarrage. Il ne crée aucun dossier dans la base de développement ou de production.

La mise en page de la connexion a été contrôlée dans le navigateur. Le tableau de bord a été inspecté en bureau et à 390 px via un rendu de composants avec exemples explicitement fictifs. La configuration réelle PostgreSQL et le service Render restent à vérifier après leur création. Le petit outil WebMCP de navigation est facultatif et utilise les permissions de la session ; son comportement n’a pas été vérifié dans un navigateur compatible.

## Structure

- `src/` : interface React, écrans et styles.
- `server/` : API Express, authentification, permissions et base de données.
- `public/noose.png` : logo original fourni, inchangé.
- `render.yaml` : ressources Render et liaison à PostgreSQL.
- `tests/` : vérifications du parcours et des permissions.

Les dossiers de production sont initialement vides. Les exemples visibles sur l’aperçu ne sont pas enregistrés dans l’application.
