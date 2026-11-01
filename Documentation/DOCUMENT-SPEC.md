---
title: Spécification du document
subtitle: Documents, bibliothèque de modules et magasin de codes dans faustmodular
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 1er novembre 2026
document-style: article-a4
language: fr
---

::: toc+
- **Objet** — ce qui manque aujourd'hui et ce que la notion de document doit apporter.
- **Ce que font les trois projets** — faustdaw, markpage, faustcode : ce qu'on reprend de chacun.
- **La thèse** — trois notions et une règle : des documents légers qui référencent un magasin de codes immuables.
- **Le code** — identité par le contenu, immuabilité, enveloppe dérivée.
- **La bibliothèque de modules** — modules prédéfinis et modules utilisateur, versions, instances épinglées.
- **Le document** — contenu, copie validée et copie de travail, frontière de l'annulation.
- **Le stockage** — disposition dans OPFS, index, persistance, collecte des codes inutilisés.
- **Les surfaces** — menu Fichier, Ouvrir, bibliothèque, indicateur de modification.
- **L'échange** — fichier exporté autonome, import, exemples, anciens formats.
- **Le partage** — entre documents, entre outils de la même origine.
- **Robustesse** — onglets multiples, quota, migration de l'existant.
- **Décisions et points ouverts** — ce que cette spécification tranche et ce qu'elle laisse ouvert.
- **Phases** — un découpage en étapes livrables, chacune utile seule.
:::

# Objet \label{sec:objet}

Aujourd'hui, faustmodular n'a pas de notion de document. La scène vit en mémoire ; on la sauve à la main dans le stockage local (clé `FaustPlayground`), en fichier ou sur Google Drive ; ouvrir un patch remplace la scène après confirmation. Les modules n'ont pas d'existence propre en dehors de la scène : un module dont on a modifié le code dans faustcode, ou un fichier `.dsp` déposé sur la scène, n'est réutilisable qu'en recopiant son code.

Nous voulons :

- un **document** qui décrit toute la scène, **persistant dans le navigateur**, sans risque de perte ni question « enregistrer avant de fermer ? » ;
- plusieurs documents, entre lesquels on passe comme entre fichiers ;
- une **bibliothèque** qui distingue les **modules prédéfinis**, livrés avec le logiciel, et les **modules utilisateur** : tout fichier source déposé sur la scène et tout module dont on modifie le code en deviennent un ;
- un **partage** simple des modules entre documents, et, à terme, entre les outils de la même origine (faustcode, faustdaw).

# Ce que font les trois projets \label{sec:existant}

Les trois projets répondent chacun à une partie de la question ; leurs choix sont compatibles.

```csv "Ce que chaque projet apporte" \label{tab:existant}
Aspect,faustdaw (spécifié),markpage (implémenté),faustcode (implémenté)
Unité,document de session (JSON) + ressources audio,bundle content.md + assets/,session = un code
Identité,sessionId opaque ; nom éditable unique ; révision = empreinte du contenu,uuid ; nom affiché dans index.json,sha1 du code
Ressources,immuables ; une compilation = une nouvelle ressource,magasin interne par SHA ; dédoublonnage invisible,le code lui-même ; jamais modifié
Persistance,copie de travail locale ; autosave,OPFS ; copie validée + copie de travail ; Save / Revert,OPFS ; brouillons de l'éditeur
Plusieurs documents,workspace des sessions ouvertes,bibliothèque + Open… + Files… + corbeille,liste chronologique des sessions
Onglets multiples,un onglet écrit (lease) ; les autres suivent,détecter + avertir (lecture seule),BroadcastChannel entre onglets
Échange,export .zip (JSON + ressources),bundle .zip ; lien pour les petits documents,lien ?code= compressé
Annulation,porte sur le document,par document,—
```

Nous reprenons :

- de **faustdaw**, la distinction **document / ressources / état d'exécution**, et l'annulation qui porte sur le document seul ;
- de **markpage**, le stockage **OPFS**, la **copie validée et la copie de travail** (Save et Revert sans risque), le **magasin interne par empreinte** qui ne fuit pas dans le modèle de l'utilisateur, la corbeille et la migration prudente ;
- de **faustcode**, l'**identité d'un code par son contenu** et la règle « éditer, c'est créer un nouveau code ».

# La thèse \label{sec:these}

::: important [La règle]
**Les documents référencent, le magasin conserve.** Un code Faust est immuable et identifié par son contenu ; la bibliothèque nomme des codes ; un document place des instances qui pointent vers des codes.
:::

Trois notions suffisent.

::: definition [Code]
Un texte source Faust, tel que l'utilisateur l'écrit (sans l'enveloppe ajoutée par faustmodular, \ref{sec:code}). Il est identifié par l'empreinte SHA-1 de son contenu et n'est jamais modifié : modifier un code, c'est créer un nouveau code.
:::

::: definition [Module de bibliothèque]
Un nom donné à un code et à la suite de ses versions. Un module est **prédéfini** (livré avec le logiciel, en lecture seule) ou **utilisateur** (créé par l'utilisateur, renommable, supprimable).
:::

::: definition [Document]
La description complète d'une scène : ses instances de modules, leurs positions, réglages et modulations, et les connexions. Chaque instance pointe vers une version précise d'un code.
:::

Tout le reste en découle :

- deux documents qui utilisent le même module partagent le même code ;
- copier une instance d'un document à l'autre ne copie qu'une référence ;
- un code reste dans le magasin tant que quelqu'un le référence (\ref{sec:collecte}) ;
- exporter un document, c'est l'accompagner des codes qu'il référence (\ref{sec:echange}).

```adt
Document ::= Doc(id, name, instances, connections, io)
Instance ::= Inst(id, name, source, code, x, y, params, modulations)   (* code : empreinte d'une version *)
Source   ::= Builtin(path)                                             (* module prédéfini *)
           | User(moduleId)                                            (* module utilisateur *)
Module   ::= BuiltinModule(path, name, category)
           | UserModule(moduleId, name, category, versions)            (* versions : empreintes, de la plus ancienne à la plus récente *)
Code     ::= Text(sha1, source)                                        (* immuable *)
```

# Le code \label{sec:code}

- **Identité.** L'empreinte est le SHA-1 du texte en UTF-8, fins de ligne normalisées en `\n`. C'est l'identité que faustcode utilise déjà pour ses sessions (\ref{sec:partage}).
- **Immuabilité.** Un code stocké n'est jamais réécrit. Une édition dans faustcode, un fichier déposé, un import produisent un nouveau code (ou retrouvent un code identique déjà présent : même empreinte, aucun doublon).
- **L'enveloppe est dérivée.** faustmodular compile chaque instance dans un groupe à son nom, `process = vgroup("<nom>", environment{ … }.process);`, qui donne leurs adresses aux paramètres. Cette enveloppe dépend de l'instance, pas du code : le magasin garde le code de l'utilisateur, et l'enveloppe est construite à la compilation (`src/model/ModuleCode.ts`).
- **Le code compilé est un cache.** Une factory compilée dépend du code effectif (code, enveloppe, modulations), des options de compilation et de la version de libfaust. Elle peut être mise en cache sous cette clé, mais elle ne fait partie ni du document ni du magasin.

# La bibliothèque de modules \label{sec:bibliotheque}

La bibliothèque a deux rayons.

- **Modules prédéfinis.** Ceux de `public/faust-modules` (index par catégories). Ils sont livrés et versionnés avec le logiciel, en lecture seule. Leur code entre dans le magasin à leur première utilisation.
- **Modules utilisateur.** Un module utilisateur a un identifiant opaque (uuid), un nom éditable, une catégorie facultative et la liste de ses versions.

Un module utilisateur est créé :

1. quand on **dépose un fichier source** sur la scène : un module utilisateur nommé d'après le fichier (ou d'après `declare name`), dont la première version est ce code ;
2. quand on **modifie le code** d'une instance dans faustcode :
   - si l'instance provient d'un module **prédéfini**, un nouveau module utilisateur est créé, nommé comme le module d'origine, avec le nouveau code comme première version ;
   - si l'instance provient déjà d'un module **utilisateur**, le nouveau code est ajouté comme nouvelle version de ce module.

Placer un module prédéfini sur la scène ne crée **pas** de module utilisateur : seule une modification ou un dépôt en crée un.

```mermaid "D'où viennent les modules utilisateur" \label{fig:creation}
flowchart LR
  F[Fichier .dsp déposé] --> N[Nouveau module utilisateur]
  P[Instance d'un module prédéfini] -- modifiée dans faustcode --> N
  U[Instance d'un module utilisateur] -- modifiée dans faustcode --> V[Nouvelle version du même module]
  N --> S[(Magasin de codes)]
  V --> S
```

**Instances épinglées.** Une instance pointe vers une version précise (une empreinte), pas vers « la dernière version » de son module. Ainsi un document se rouvre à l'identique, et l'annulation reste exacte. Quand le module a une version plus récente, la bibliothèque le signale sur l'instance, et une action **Mettre à jour** la fait passer à la dernière version (une modification ordinaire, donc annulable). L'instance que l'on vient de modifier dans faustcode passe, elle, directement à la nouvelle version.

**Gérer les modules utilisateur** : renommer, changer de catégorie, supprimer (vers la corbeille), voir les versions et les documents qui les utilisent. Supprimer un module utilisateur ne casse aucun document : ses instances gardent leur code, puisqu'elles pointent vers des empreintes.

# Le document \label{sec:document}

## Contenu \label{sec:contenu}

Un document contient ce que l'utilisateur crée et peut annuler :

- son nom ;
- les instances : identifiant, nom (celui du groupe Faust), source, empreinte du code, position, valeurs des paramètres, réglages d'accéléromètre, modulations (widget, mode, bornes) ;
- les positions des modules d'entrée et de sortie physiques ;
- les connexions.

Il ne contient pas :

- la sélection, l'état du menu, l'historique d'annulation (version 1, \ref{sec:decisions}) ;
- le nombre de canaux de l'entrée physique, qui dépend du matériel ;
- les codes eux-mêmes, ni les factories compilées : il les référence.

Ce contenu est exactement l'état qu'utilise déjà l'annulation (`Scene.captureSnapshot`), à la différence près que les codes y sont remplacés par leurs empreintes : **la frontière de l'annulation est le document**, comme dans faustdaw.

```json "Document, format version 4"
{
  "format": "faustmodular-document",
  "version": 4,
  "name": "Vibrato",
  "instances": [
    {
      "id": "1", "name": "SOscillator",
      "source": { "kind": "builtin", "path": "generators/SOscillator.dsp" },
      "code": "3f1c…", "x": 480, "y": 120,
      "params": { "/SOscillator/Frequency": 300 },
      "acc": [], "modulations": [ { "widget": "/SOscillator/Frequency", "mode": "modulate", "…": "…" } ]
    }
  ],
  "io": { "input": { "x": 10, "y": 425 }, "output": { "x": 1302, "y": 425 } },
  "connections": [ "2:0>1:1", "1:0>output:0" ]
}
```

## Copie validée et copie de travail \label{sec:save}

Chaque document a deux états, comme dans markpage :

- la **copie validée**, le dernier état enregistré ;
- la **copie de travail**, l'état courant, **sauvegardé automatiquement** à chaque étape de l'historique (après 400 ms de calme).

| Geste | Effet |
| :-- | :-- |
| Autosave | écrit la copie de travail, jamais la copie validée |
| Enregistrer (Cmd/Ctrl-S) | copie validée ← copie de travail |
| Revenir à la version enregistrée | la copie de travail est abandonnée |
| Enregistrer sous… | la copie de travail devient un nouveau document ; l'original redevient propre |

Le document est **modifié** quand la copie de travail diffère de la copie validée : un point (●) le signale à côté de son nom. Comme la copie de travail est persistée, on peut fermer l'onglet et revenir : rien n'est perdu, et la question « enregistrer avant de fermer ? » disparaît. La confirmation actuelle avant de remplacer une scène modifiée devient inutile : ouvrir un autre document ne détruit rien.

## Identité \label{sec:identite}

Un document a un **identifiant** opaque (uuid), stable, et un **nom** éditable. Les noms sont uniques dans le navigateur : en cas de collision, un suffixe ` 2`, ` 3`… est ajouté (règle de faustdaw).

# Le stockage \label{sec:stockage}

Le stockage repose sur l'**Origin Private File System** (OPFS), comme markpage et faustcode.

```tree "Disposition dans OPFS"
faustmodular/
  index.json            documents et modules utilisateur : identifiants, noms, dates, états
  documents/
    <uuid>/
      committed.json     copie validée
      working.json       copie de travail (absente si le document est propre)
  modules/
    <uuid>.json          module utilisateur : nom, catégorie, versions
  codes/
    <sha1>.dsp           magasin de codes, partagé
  trash/                 documents et modules supprimés, restaurables
  cache/                 factories compilées (reconstructibles)
```

- **Persistance.** L'application demande `navigator.storage.persist()` pour éviter l'éviction silencieuse, et affiche l'espace utilisé (`navigator.storage.estimate()`).
- **Écriture sûre.** Un code est écrit avant tout document qui le référence ; `index.json` est réécrit en dernier.

## Collecte des codes inutilisés \label{sec:collecte}

Un code est **vivant** s'il est référencé par :

- une version d'un module utilisateur (corbeille comprise) ;
- la copie validée ou la copie de travail d'un document (corbeille comprise) ;
- l'historique d'annulation du document ouvert (en mémoire).

La collecte marque les codes vivants à partir de ces racines et supprime les autres. Elle a lieu au démarrage et quand on vide la corbeille, jamais pendant une restauration de l'historique. Les codes des modules prédéfinis sont toujours reconstructibles et peuvent être collectés comme les autres.

# Les surfaces \label{sec:surfaces}

Le menu actuel (Library, Load, Edit, Save, Export) évolue ainsi :

```
Fichier ▾
 Nouveau document           Cmd/Ctrl-N
 Ouvrir…                    Cmd/Ctrl-O      liste des documents, recherche
 ──────────────
 Enregistrer                Cmd/Ctrl-S
 Enregistrer sous…
 Revenir à la version enregistrée
 ──────────────
 Renommer… · Dupliquer · Supprimer
 Exporter… · Importer…
 Nouveau depuis un exemple ▸
```

- Le **nom du document** est affiché dans l'en-tête, éditable par un clic, avec le point de modification.
- La **bibliothèque** garde ses colonnes de modules prédéfinis et ajoute une colonne **Mes modules** (modules utilisateur), avec renommer, catégorie, supprimer, versions.
- **Export** garde l'export en programme Faust et les cibles du service de compilation ; l'export du document rejoint le menu Fichier.

# L'échange \label{sec:echange}

- **Exporter un document** produit un fichier JSON **autonome** : le document et les codes qu'il référence, ainsi que les métadonnées des modules utilisateur concernés (nom, catégorie). Les codes étant du texte, un fichier unique suffit, sans archive.
- **Importer** ajoute les codes au magasin (sans doublon, grâce aux empreintes), crée les modules utilisateur absents (ou rattache ceux qui existent déjà, reconnus par leur identifiant) et ouvre le document comme un **nouveau** document : l'import n'écrase jamais un document existant.
- **Exemples.** Les exemples du menu actuel deviennent « Nouveau depuis un exemple » : chacun crée un nouveau document.
- **Anciens formats.** Les fichiers des versions 1, 2 et 3 s'importent de la même façon : chaque code est extrait (sans son enveloppe) vers le magasin, et chaque instance devient la première version d'un module utilisateur, sauf si son code est identique à celui d'un module prédéfini.
- **Partage par lien** (plus tard) : un document compressé dans l'URL, comme les liens de faustcode, plafonné en taille ; au-delà, le fichier exporté.

# Le partage \label{sec:partage}

- **Entre documents.** Les modules utilisateur appartiennent au navigateur, pas à un document : tous les documents les voient dans la bibliothèque. Copier des instances d'un document à l'autre (plus tard) ne copie que des références.
- **Entre outils de la même origine.** faustmodular, faustcode et faustdaw, hébergés sous `orlarey.github.io`, partagent l'OPFS de cette origine. faustcode identifie déjà ses sessions par le SHA-1 du code : le magasin de codes peut devenir **commun**. Une édition dans faustcode n'aurait alors plus besoin de transporter le code par message, seulement son empreinte. C'est la « publication » du document de conception sur les applis coopérantes. Ce partage est une perspective : la version 1 garde son propre magasin, avec la même convention d'empreinte pour rendre la convergence triviale.

## Perspective : fauststore \label{sec:fauststore}

À plus long terme, le magasin local appelle un **magasin public** de code Faust, une sorte de GitHub spécialisé : **fauststore**. On y trouverait des codes **versionnés**, **décrits**, **catégorisés**, **classés** et éventuellement **évalués**.

La thèse de ce document le prépare sans rien imposer :

- les codes sont déjà identifiés par leur contenu : un code reste le même dans le magasin local et dans fauststore, sans doublon ;
- un module utilisateur, avec la suite de ses versions, est l'unité naturelle à **publier** ; les métadonnées `declare` de Faust (nom, auteur, licence, version, description) en fournissent une première description ;
- un module récupéré de fauststore se comporte comme un module de bibliothèque : ses instances sont attachées à une version précise, et « Mettre à jour » propose les versions publiées depuis.

# Robustesse \label{sec:robustesse}

- **Onglets multiples.** Deux onglets sur le même document risquent de s'écraser. Défaut retenu, comme markpage : **détecter et avertir**. Le second onglet ouvre le document en lecture seule, par `BroadcastChannel`. Plus tard : un seul onglet écrit, les autres suivent (le *lease* de faustdaw).
- **Quota dépassé.** L'erreur d'écriture est interceptée et signalée, avec l'espace utilisé et les moyens d'en libérer (vider la corbeille).
- **Migration de l'existant.** Au premier démarrage, de façon idempotente :
  1. chaque scène de la clé `FaustPlayground` du stockage local devient un document (copie validée = la scène) ;
  2. ses codes partent dans le magasin, ses instances deviennent des modules utilisateur (règle des anciens formats, \ref{sec:echange}) ;
  3. la migration est marquée faite ; l'ancienne clé est conservée en filet de sécurité, puis effacée après au moins 7 jours **et** 2 démarrages réussis (règle de markpage).
- **Aucun abandon silencieux.** Ce qui ne peut être importé ou migré (un code qui ne compile plus) est signalé, jamais perdu sans trace.

# Décisions et points ouverts \label{sec:decisions}

Décisions prises par cette spécification :

1. Un code est immuable et identifié par le SHA-1 de son texte ; le magasin garde le code de l'utilisateur, sans enveloppe.
2. Une instance est épinglée à une version ; « Mettre à jour » est explicite et annulable.
3. Placer un module prédéfini ne crée pas de module utilisateur ; déposer un fichier ou modifier un code en crée un (ou une nouvelle version).
4. Copie validée et copie de travail, sauvegarde automatique de la copie de travail ; ouvrir ou importer ne remplace jamais un document.
5. Stockage OPFS ; collecte des codes par marquage depuis les modules, les documents et l'historique ouvert.
6. Fichier exporté autonome, en JSON, format version 4.

Points ouverts :

- **Persister l'historique d'annulation** avec la copie de travail, comme le prévoit faustdaw, pour le retrouver après un rechargement.
- **Workspace** : un seul document ouvert par onglet (proposé pour la version 1), ou plusieurs documents ouverts entre lesquels on bascule.
- **Préréglages** de modules : enregistrer des jeux de paramètres selon le même principe (contenu identifié par empreinte), comme les préréglages de faustdaw.
- **Synchronisation** avec Google Drive : la conserver comme cible d'export, ou la retirer.
- **Magasin commun** avec faustcode et faustdaw (\ref{sec:partage}).
- **fauststore**, magasin public de code Faust (\ref{sec:fauststore}) : pas pour tout de suite, mais la convention d'empreinte et les modules utilisateur versionnés le préparent.

# Phases \label{sec:phases}

Chaque phase est utile seule.

1. **Documents.** Magasin de codes, documents en OPFS (copie validée et de travail), autosave, Nouveau, Ouvrir, Enregistrer, Revenir, Renommer, Dupliquer, Supprimer, corbeille ; migration du stockage local. La bibliothèque reste celle d'aujourd'hui.
2. **Modules utilisateur.** Création au dépôt d'un fichier et à la modification dans faustcode, versions, instances épinglées et mise à jour, colonne Mes modules.
3. **Échange.** Export et import du document autonome (version 4), import des anciens formats, exemples comme modèles.
4. **Confort.** Lecture seule du second onglet, cache des factories compilées, espace utilisé, persistance de l'historique.
5. **Convergence.** Magasin commun avec faustcode, puis faustdaw.
