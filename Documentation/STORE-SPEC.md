---
title: Spécification du magasin
subtitle: Publier, retrouver et partager des modules et des scènes dans un dépôt GitHub (fauststore)
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 6 novembre 2026
document-style: article-a4
language: fr
---

::: toc+
- **Objet** — ranger, retrouver et partager ses modules et ses scènes, au-delà d'un navigateur.
- **La thèse** — un magasin est un dépôt GitHub de structure convenue ; l'application lui parle directement.
- **Le dépôt** — sa disposition, son manifeste, son index.
- **Les modules** — un fichier `.dsp` valide, décrit par ses `declare`.
- **Les scènes** — un fichier autonome, qui sonne à l'identique.
- **Les versions** — l'historique de git et les empreintes des codes.
- **Représentations et matériaux** — une œuvre et ses représentations : la recette (la scène) et ce qu'elle a produit (un enregistrement), liées.
- **Lire** — sans compte, pour les magasins publics.
- **Publier** — avec une autorisation limitée au dépôt, en un commit.
- **Dans faustmodular** — bibliothèque, menu Fichier, liens, réglages.
- **Découvrir et contribuer** — les magasins des autres.
- **Sécurité** — le jeton, le contenu d'autrui.
- **Limites** — ce que GitHub impose.
- **Décisions et points ouverts**
- **Phases**
:::

# Objet \label{sec:objet}

Aujourd'hui, les documents et les modules utilisateur de faustmodular vivent dans le navigateur (OPFS, `DOCUMENT-SPEC.md`). On peut exporter une scène dans un fichier, mais rien ne permet de **ranger** ses travaux hors du navigateur, de les **retrouver** depuis un autre ordinateur, ni de les **partager** autrement qu'en envoyant un fichier.

Le magasin répond aux trois besoins :

- **ranger** : publier une scène ou un module dans son magasin, depuis faustmodular ;
- **retrouver** : parcourir et chercher son magasin, depuis n'importe quel navigateur, et en tirer un module ou une scène ;
- **partager** : un magasin public se lit sans compte ; on suit les magasins des autres, on ouvre une scène par un lien.

C'est la forme concrète de la perspective *fauststore* de `DOCUMENT-SPEC.md` (« Perspective : fauststore ») : des codes identifiés par leur contenu, versionnés, décrits et classés, dans un registre ouvert.

::: note [Vocabulaire]
Dans ce document, **magasin** désigne un dépôt GitHub organisé selon cette spécification. Le magasin de codes d'OPFS décrit par `DOCUMENT-SPEC.md` est appelé **magasin local**.
:::

# La thèse \label{sec:these}

::: important [Un magasin est un dépôt git]
Un magasin est un **dépôt GitHub** dont la disposition est convenue. Son contenu est du **texte dans les formats existants** : un module est un programme Faust, une scène est un fichier faustmodular. L'application lit et écrit le dépôt **directement, par l'API de GitHub**, sans serveur à elle.
:::

Les conséquences :

- **Lisible hors de faustmodular.** Le dépôt se parcourt sur GitHub, un module s'ouvre dans faustcode ou se compile avec `faust`, une scène s'ouvre dans faustmodular par le menu Fichier. Rien n'est enfermé dans une base opaque.
- **Identité par le contenu.** Un code est identifié par le SHA-1 de son texte, comme dans le magasin local : un module tiré d'un magasin, puis retrouvé dans un document, est reconnu sans doublon, et son statut se déduit de son contenu (`DOCUMENT-SPEC.md`, « Le statut se déduit du contenu »).
- **Versions gratuites.** git garde l'historique de chaque fichier ; l'index du magasin en retient les empreintes, pour proposer les mises à jour (\ref{sec:versions}).
- **Sans serveur.** faustmodular reste un site statique (GitHub Pages). Lire un magasin public ne demande aucun compte ; écrire demande une autorisation limitée au dépôt (\ref{sec:publier}).
- **Décentralisé.** Chacun son magasin, ou plusieurs ; on les découvre par un *topic* GitHub (\ref{sec:decouvrir}) ; on contribue au magasin d'un autre par une *pull request*, avec la relecture et l'historique que git fournit.
- **Commun aux outils.** Les modules sont des `.dsp` ordinaires : faustcode peut lire et publier dans le même magasin, faustdaw plus tard.

# Le dépôt \label{sec:depot}

Un magasin est un dépôt GitHub, public ou privé, qui contient un fichier `fauststore.json` à sa racine, sur sa branche par défaut. Un **dépôt modèle** (`fauststore-template`, à publier) donne la disposition, un `README.md` et le manifeste à remplir : on crée son magasin en un clic (*Use this template*).

## Disposition

```
fauststore.json                     le manifeste
index.json                          l'index : ce que contient le magasin (dérivé, refait à chaque publication)
modules/<Nom>/<Nom>.dsp             un module : un programme Faust
modules/<Nom>/README.md             sa présentation (facultative)
modules/<Nom>/*.png                 ses images (facultatives)
scenes/<Nom>/<Nom>.jfaust           une scène : un fichier faustmodular autonome
scenes/<Nom>/preview.png            son aperçu (facultatif)
scenes/<Nom>/README.md              sa présentation (facultative)
materials/<Nom>/<Nom>.json          un matériau : sa fiche (\ref{sec:materiaux})
materials/<Nom>/<Nom>.flac          son média (audio ; ou un lien, pour un média trop lourd)
libraries/<sha1>.lib                des fichiers de bibliothèques Faust, par empreinte (phase 6, \ref{sec:phases})
```

- Un dossier par élément : il peut porter une présentation et des images, que GitHub affiche.
- `<Nom>` est le nom de l'élément (le `declare name` d'un module, le nom d'une scène), réduit aux lettres, chiffres, `-` et `_` ; il est unique dans `modules/` et dans `scenes/`. Le **chemin** du fichier principal est l'identité de l'élément dans le magasin.
- Rien n'interdit d'autres fichiers (un `README.md` général, une licence) : faustmodular les ignore.

## Le manifeste

```json
{
  "format": "fauststore",
  "version": 1,
  "name": "Modules de Yann",
  "description": "Synthèse modulaire, percussions, études pour le cours d'informatique musicale",
  "author": "Yann Orlarey",
  "license": "MIT",
  "language": "fr"
}
```

`license` est la licence par défaut des éléments (un identifiant SPDX) ; un module peut déclarer la sienne (`declare license`).

## L'index

L'index décrit le contenu du magasin, pour qu'on le parcoure et qu'on y cherche sans lire chaque fichier. Il est **dérivé** : faustmodular le refait à chaque publication. C'est un **cache vérifié** : chaque entrée porte l'empreinte git de son fichier (`sha`, le *blob*), et un lecteur ne garde une entrée que si le fichier du dépôt a toujours cette empreinte ; il lit les autres (\ref{sec:lire}). Un module ajouté ou modifié à la main sur GitHub n'est donc jamais caché par un index en retard. Il n'est jamais la seule source d'une information, à une exception près, les versions passées (\ref{sec:versions}), qui se retrouvent aussi dans l'historique git.

```json
{
  "format": "fauststore-index",
  "version": 1,
  "updated": "2026-11-06T10:00:00Z",
  "modules": [
    {
      "path": "modules/Drone/Drone.dsp",
      "name": "Drone",
      "author": "Yann Orlarey",
      "license": "MIT",
      "summary": "Drone: three detuned saws through a slow filter",
      "functions": ["Oscillator"],
      "inlets": ["pitch"],
      "outlets": ["out"],
      "inputs": 1,
      "outputs": 1,
      "code": "8f22aa96883b8e877786d948acb9cc673cd52ce2",
      "versions": [
        { "code": "1b0e…", "commit": "a3f9…", "date": "2026-10-30T18:12:00Z" }
      ],
      "updated": "2026-11-06T10:00:00Z"
    }
  ],
  "scenes": [
    {
      "path": "scenes/Nappe/Nappe.jfaust",
      "name": "Nappe",
      "summary": "Deux drones, un LFO lent sur le filtre",
      "author": "Yann Orlarey",
      "preview": "scenes/Nappe/preview.png",
      "codes": ["8f22aa96…", "6d1559ec…"],
      "updated": "2026-11-06T10:00:00Z"
    }
  ],
  "materials": [
    {
      "path": "materials/Nappe-1/Nappe-1.json",
      "name": "Nappe-1",
      "kind": "recording",
      "media": "materials/Nappe-1/Nappe-1.flac",
      "duration": 60.0,
      "updated": "2026-11-06T10:00:00Z"
    }
  ],
  "links": [
    { "rel": "recordingOf", "from": "materials/Nappe-1/Nappe-1.json", "to": "scenes/Nappe/Nappe.jfaust", "sha1": "…" },
    { "rel": "uses", "from": "scenes/Nappe/Nappe.jfaust", "to": "modules/Drone/Drone.dsp", "sha1": "8f22aa96…" }
  ]
}
```

- `code` : le SHA-1 du code du module tel qu'il est publié ; `versions` : les versions précédentes, de la plus récente à la plus ancienne, en ajout seul, avec le commit qui les contient.
- `inputs`, `outputs` : l'arité du module compilé, pour le placer sans le compiler.
- `codes` d'une scène : les empreintes des codes de ses modules, pour savoir sans l'ouvrir quels modules elle utilise.
- `links` : les relations entre éléments (\ref{sec:materiaux}), dérivées de leurs fiches et de leur contenu ; chacune se lit dans les deux sens.

# Les modules \label{sec:modules}

Un module est un **programme Faust valide**, tel que l'utilisateur l'écrit : le code de son module utilisateur, **sans l'enveloppe** que faustmodular lui ajoute (le groupe à son nom, les circuits de modulation, `DOCUMENT-SPEC.md`, « Le code »). Son empreinte est donc la même que dans le magasin local.

Il se décrit par les métadonnées de Faust, comme les modules de la bibliothèque livrée :

| Métadonnée | Rôle |
| :-- | :-- |
| `declare name` | son nom |
| `declare author`, `declare license`, `declare version` | l'auteur, la licence (SPDX), un numéro de version lisible |
| `declare summary` | une ligne de présentation (la bibliothèque la montre) |
| `declare function`, `declare function2` | ses fonctions, au sens de ModularGrid (les familles de la bibliothèque) |
| `declare inlets`, `declare outlets` | le nom de ses ports |
| le commentaire `DESCRIPTION` | sa description détaillée |

Publier un module ne le transforme pas : un module sans métadonnées se publie, avec son nom et l'auteur du magasin. faustmodular propose de compléter `summary` et `author` au moment de publier, et l'écrit alors dans le code, qui devient une nouvelle version.

# Les scènes \label{sec:scenes}

Une scène est publiée sous la forme du **fichier que faustmodular enregistre aujourd'hui** (`.jfaust`, format *faustplayground-patch* version 2 ou 3) : il contient le code de chacun de ses modules. Il est donc **autonome** : il se rouvre et sonne à l'identique, même si les magasins dont ses modules proviennent ont changé depuis.

- Quand l'export autonome version 4 (`DOCUMENT-SPEC.md`, « L'échange ») existera, il remplacera ce format : il porte en plus les métadonnées des modules utilisateur et l'environnement des bibliothèques Faust.
- L'aperçu (`preview.png`) est une image de la scène, faite par faustmodular au moment de publier ; il est facultatif.
- Le nom, la présentation et l'auteur d'une scène sont dans l'index ; la présentation détaillée, dans son `README.md`.

# Les versions \label{sec:versions}

- **Un module publié de nouveau** remplace son fichier : son code précédent rejoint `versions` dans l'index, avec le commit qui le contient. Une ancienne version se relit par ce commit (`raw.githubusercontent.com/<dépôt>/<commit>/<chemin>`), sans parcourir l'historique.
- **Le statut se déduit du contenu**, comme pour la bibliothèque livrée (`DOCUMENT-SPEC.md`, « Le statut se déduit du contenu ») : une instance dont le code figure dans `versions` d'un module d'un magasin suivi est une ancienne version de ce module, et faustmodular propose de la **mettre à jour** (le badge du module). La mise à jour reste explicite et annulable ; une scène n'est jamais modifiée par une publication.
- **Une scène publiée de nouveau** remplace son fichier ; l'historique git garde les précédentes.
- **Retirer** un élément le supprime du dépôt et de l'index (le commit le garde) ; les instances qui l'utilisaient gardent leur code.

# Représentations et matériaux \label{sec:materiaux}

Une œuvre a plusieurs **représentations** : sa **recette** (des modules, une scène : du code qui produit du son) et les **matériaux** qu'elle a produits (un enregistrement audio, une vidéo). Le magasin garde les unes et les autres, et le **lien** entre elles : depuis faustdaw, un enregistrement devient la matière d'une piste, et l'on retrouve la scène qui l'a produit ; depuis la scène, ses enregistrements. C'est une **provenance**, au sens du modèle W3C PROV : ce matériau a été *généré par* cette activité (l'enregistrement), *à partir de* cette entité (la scène), à telle version.

## Les matériaux

Un matériau est un dossier `materials/<Nom>/` : sa **fiche** (`<Nom>.json`) et son **média**.

```json
{
  "format": "fauststore-material",
  "version": 1,
  "kind": "recording",
  "name": "Nappe-1",
  "media": { "path": "Nappe-1.flac", "type": "audio/flac", "sha1": "…", "preview": "Nappe-1.opus" },
  "sampleRate": 48000,
  "channels": 2,
  "frames": 2880000,
  "from": { "store": "orlarey/faust-store", "path": "scenes/Nappe/Nappe.jfaust", "sha1": "…", "commit": "…" },
  "generator": "faustmodular 3.46.0",
  "timeline": { "tempo": 120, "meter": 4, "startTick": 0, "lengthTicks": 61440 },
  "live": ["gestures"],
  "date": "2026-11-06T10:00:00Z"
}
```

- `from` : la recette, par son chemin **et l'empreinte de son contenu**. Le lien est vérifiable : on retrouve la scène telle qu'elle était au moment de l'enregistrement, même si elle a évolué depuis (le commit la garde).
- `timeline` : où l'enregistrement commence dans la ligne de temps de faust-sync, et combien de temps il dure, en tics entiers (`FAUST-SYNC-SPEC.md`). faustdaw le pose sur sa grille au tic près, et sait son tempo.
- `live` : ce que la recette ne rejoue pas, parmi `microphone`, `midi`, `gestures` (les réglages bougés à la main), `sync` (une autre application jouait). Sans entrée vivante, la scène est **déterministe** : l'enregistrement n'est qu'une matérialisation de la recette, qu'un rendu hors ligne (`OfflineAudioContext`) pourrait refaire, plus vite que le temps réel. Avec des gestes, il faudra les noter aussi (une automation), pour que la recette reste complète.
- D'autres genres viendront (`kind`) : un rendu hors ligne, une vidéo, un projet faustdaw.

## Les relations

| Relation | De | Vers | Sens |
| :-- | :-- | :-- | :-- |
| `recordingOf` | un matériau | une scène | il en est un enregistrement |
| `uses` | une scène | un module | elle l'utilise (par l'empreinte de son code) |
| `derivedFrom` | un module, une scène | un module, une scène | il en est une modification |
| `usedIn` | un matériau | un projet faustdaw | il y sert de matière (plus tard) |

Une relation est écrite dans l'élément qui la porte (la fiche d'un matériau, le contenu d'une scène) ; l'index les recense toutes (`links`) et se lit **dans les deux sens**. Une relation peut viser un autre magasin (`store`).

## Les médias

| Média | Taille | Où |
| :-- | :-- | :-- |
| FLAC (sans perte) | ≈ 6 Mo par minute (48 kHz, stéréo) | dans le dépôt, jusqu'à 50 Mo par fichier |
| Opus (pour l'écoute) | ≈ 1 Mo par minute | dans le dépôt, un aperçu à côté du FLAC |
| WAV | ≈ 11,5 Mo par minute | non : FLAC à la place, sans perte |
| vidéo, audio plus long | des dizaines de Mo par minute | hors du dépôt : la fiche donne un lien (`media.url`) |

Un dépôt git garde chaque version de chaque fichier, et GitHub recommande de rester sous quelques Go : les médias lourds restent hors du dépôt. Pour eux, les *Releases* de GitHub (jusqu'à 2 Go par fichier, hors de l'historique) sont une piste, à vérifier : il faut qu'une page web puisse les télécharger.

## Enregistrer depuis faustmodular

Le transport offre **● Enregistrer** : la sortie principale (après le volume et le limiteur), à l'échantillon près, par un AudioWorklet ; à partir d'un début de mesure, pour un nombre de mesures choisi ou jusqu'à ■. Le matériau se télécharge (FLAC ou WAV) ; et il se publie avec sa scène, **en un seul commit**, déjà lié. C'est une fonctionnalité de faustmodular à part entière : elle sert aussi sans magasin.

# Lire \label{sec:lire}

Lire un magasin public ne demande **aucun compte** :

1. `https://raw.githubusercontent.com/<propriétaire>/<dépôt>/HEAD/fauststore.json` : le manifeste (`HEAD` désigne la branche par défaut) ;
2. `…/HEAD/index.json` : l'index ;
3. les fichiers, à la demande : un module quand on le place, une scène quand on l'ouvre.

`raw.githubusercontent.com` accepte les requêtes d'une autre origine (CORS) et n'est pas soumis à la limite de l'API (60 requêtes par heure sans compte). Il met les fichiers en cache quelques minutes : un magasin d'un autre se voit avec ce retard ; son propriétaire, après avoir publié, lit par l'API (\ref{sec:publier}), sans retard.

**L'arborescence**, en un appel (`GET /repos/<dépôt>/git/trees/HEAD?recursive=1`), donne les fichiers du dépôt et leur empreinte git : faustmodular garde les entrées de l'index dont le fichier n'a pas changé, et lit les autres (un module ajouté à la main, un index absent). Un magasin peut donc être tenu sans faustmodular. Si l'API ne répond pas (sa limite atteinte), l'index sert seul.

**Un magasin privé** se lit avec l'autorisation de son propriétaire, par l'API (`GET /repos/<dépôt>/contents/<chemin>`).

Les codes lus entrent dans le magasin local, par empreinte : un module déjà présent n'est pas téléchargé deux fois, et un magasin déjà parcouru reste consultable hors ligne.

# Publier \label{sec:publier}

## L'autorisation

faustmodular est un site statique : il ne peut pas garder de secret. La première version utilise un **jeton d'accès personnel à droits limités** (*fine-grained personal access token*) :

- créé une fois par l'utilisateur, sur GitHub, pour **le seul dépôt de son magasin**, avec la permission **Contents : lecture et écriture** ;
- collé dans *Mon magasin…* (menu Fichier), qui le vérifie (le dépôt lisible et inscriptible avec lui), le garde dans le navigateur (`localStorage`) et ne l'envoie qu'à `api.github.com` ;
- révocable à tout moment sur GitHub, avec une date d'expiration.

faustmodular conduit la création : un lien vers la page de GitHub, les réglages à choisir, puis une vérification du jeton (`GET /repos/<dépôt>` : le dépôt est accessible et inscriptible).

Plus tard, une connexion **« Se connecter avec GitHub »** (OAuth, par une GitHub App) éviterait le jeton à copier. Elle demande un petit relais, car les points d'entrée `github.com/login/…` n'acceptent pas les requêtes d'une page web : quelques lignes sur un service sans état (un Cloudflare Worker, par exemple), sans données conservées.

## Le commit

Une publication est **un seul commit**, par l'API Git de GitHub :

1. la branche : `GET /repos/<dépôt>/git/ref/heads/<branche>`, puis le commit et son arbre ;
2. les fichiers : `POST /git/blobs` pour chacun (le code, l'aperçu, l'index refait) ;
3. l'arbre : `POST /git/trees`, sur l'arbre courant ;
4. le commit : `POST /git/commits`, avec un message (« Publier le module Drone », et la version de faustmodular) ;
5. la branche avancée : `PATCH /git/refs/heads/<branche>`, sans forcer. Si quelqu'un a publié entre-temps, la branche a bougé : faustmodular relit l'index, refait la publication sur le nouveau commit et recommence.

Un module se publie depuis la colonne *Mes modules* ou depuis le menu d'un module ; une scène, depuis le menu Fichier. Si le chemin existe déjà avec un autre contenu : pour un module, c'est une **nouvelle version** ; pour une scène, faustmodular demande s'il faut la remplacer ou la publier sous un autre nom.

# Dans faustmodular \label{sec:surfaces}

- **Réglages : Mes magasins.** *Mon magasin* (le dépôt où je publie, avec son jeton) ; les **magasins suivis**, en lecture (on en ajoute par `propriétaire/dépôt`, ou depuis la découverte, \ref{sec:decouvrir}) ; on peut en suivre plusieurs, et n'en avoir qu'un où publier.
- **La bibliothèque** (menu Modules) : une famille **Magasins**, un groupe par magasin suivi ; la recherche les couvre ; placer un module d'un magasin, c'est comme placer un module livré. L'instance retient sa **provenance** (magasin, chemin, empreinte), pour l'affichage et pour la mise à jour.
- **Le menu Fichier** : *Ouvrir depuis un magasin…* (les scènes, avec leur aperçu ; une scène ouverte devient un **nouveau** document, comme un import) ; *Publier dans mon magasin…*.
- **Les liens** : `…/faustmodular/?store=<propriétaire>/<dépôt>&scene=<chemin>` ouvre une scène publiée, sans compte ; `&ref=<commit>` l'ouvre dans une version précise. `?store=<propriétaire>/<dépôt>` seul ouvre la bibliothèque sur ce magasin. Un lien se copie depuis la scène ou le module (\ref{sec:partager}).

## Partager une scène par son adresse \label{sec:partager}

La façon la plus simple de partager une scène : mettre **l'adresse de son fichier** dans celle de faustmodular.

```
https://orlarey.github.io/faustmodular/?scene=https://github.com/orlarey/faust-store/blob/main/scenes/Nappe/Nappe.jfaust
```

- L'adresse est celle que GitHub montre quand on ouvre le fichier (`github.com/<propriétaire>/<dépôt>/blob/<ref>/<chemin>`), ou celle du fichier brut (`raw.githubusercontent.com/<propriétaire>/<dépôt>/<ref>/<chemin>`) : on la copie dans le navigateur, on la colle après `?scene=`. Elle peut aussi s'écrire encodée (`encodeURIComponent`), comme toute valeur d'une adresse.
- faustmodular en tire le magasin, la version (`<ref>` : une branche, une étiquette ou un commit) et le chemin : c'est le lien `?store=<propriétaire>/<dépôt>&scene=<chemin>&ref=<ref>`. La scène s'ouvre comme une nouvelle scène, sans compte, et sa provenance est connue (le magasin, le chemin, la version).
- Avec un commit, le lien désigne cette version pour toujours, même si la scène est publiée de nouveau ; avec une branche, la dernière version publiée.
- Une branche dont le nom contient `/` n'est pas reconnue dans l'adresse de GitHub (elle y est ambiguë avec le chemin) : la forme `?store=…&scene=…&ref=…` la permet.
- faustmodular **fabriquera le lien** (phase 2) : après une publication, et pour une scène d'un magasin, *Copier le lien de partage* le mettra dans le presse-papiers, avec le commit de la version publiée.
- Seules les adresses de GitHub sont reconnues : un fichier ailleurs n'a ni magasin ni provenance, et son serveur doit permettre la lecture depuis une autre origine (CORS) ; il reste possible plus tard.
- **faustcode** : `…/faustcode/?store=<propriétaire>/<dépôt>&file=<chemin>` ouvre un module d'un magasin ; le même magasin, le même jeton (même origine), et *Publier* fait une nouvelle version.

# Découvrir et contribuer \label{sec:decouvrir}

- **Le topic `fauststore`.** Un magasin public porte le *topic* GitHub `fauststore` (le dépôt modèle l'a déjà). faustmodular les liste par `GET /search/repositories?q=topic:fauststore` (sans compte : 10 requêtes par minute), avec leur nom, leur description et leurs étoiles, et on suit ceux qu'on veut.
- **Un magasin de référence**, chez GRAME, pourrait recueillir les meilleurs modules et lister des magasins recommandés.
- **Contribuer au magasin d'un autre** : par une *pull request*, d'abord à la main sur GitHub ; plus tard depuis faustmodular (un *fork* et une *pull request* par l'API).

# Sécurité \label{sec:securite}

- **Le jeton** ne donne accès qu'au dépôt du magasin, et seulement à son contenu ; il expire. Il est gardé dans le stockage de l'origine `orlarey.github.io`, que partagent faustmodular, faustcode et faustdaw : les trois sont les nôtres, et aucun script d'un tiers n'y est chargé. Il ne quitte le navigateur que vers `api.github.com`.
- **Le contenu d'autrui.** Un module est du code Faust, compilé en WebAssembly dans le bac à sable du navigateur : aucun JavaScript arbitraire ne s'exécute. Un son trop fort est arrêté par le limiteur de sortie. Les fichiers JSON sont validés avant usage ; une présentation est affichée comme du texte (le Markdown rendu sans HTML), les images comme des images.
- **Les données personnelles** : un magasin public est public, y compris son historique. faustmodular le rappelle à la première publication dans un dépôt public.

# Limites \label{sec:limites}

- **Publier demande un compte GitHub.** Lire, non.
- **Les limites de l'API** : 60 requêtes par heure sans compte (d'où la lecture par `raw.githubusercontent.com`), 5000 avec un jeton ; la recherche, 10 par minute sans compte.
- **Le cache de `raw.githubusercontent.com`** : quelques minutes de retard pour voir une publication d'un autre.
- **La taille** : GitHub refuse les fichiers de plus de 100 Mo et déconseille au-delà de 50 Mo ; un module ou une scène pèse quelques kilo-octets, un aperçu quelques dizaines.
- **Les bibliothèques Faust** : un module qui importe `stdfaust.lib` dépend de la version des bibliothèques ; tant qu'elles ne sont pas épinglées (`DOCUMENT-SPEC.md`, « Les bibliothèques Faust sont épinglées »), un module publié il y a longtemps peut sonner autrement. Le dossier `libraries/` est prévu pour cela (phase 6).

# Décisions et points ouverts \label{sec:decisions}

Décisions proposées, à valider :

1. Un magasin est un dépôt GitHub de disposition convenue, avec un manifeste `fauststore.json` ; un dépôt modèle sert à le créer.
2. Les modules sont des `.dsp` valides, sans l'enveloppe de faustmodular, décrits par leurs `declare` ; les scènes, le fichier `.jfaust` autonome.
3. Les codes sont identifiés par leur SHA-1, comme dans le magasin local ; le statut et les mises à jour se déduisent du contenu.
4. L'index est dérivé, refait à chaque publication, et vérifié à la lecture par l'empreinte git de chaque fichier ; seules les versions passées y sont mémorisées, et l'historique git les garde aussi.
5. Lire sans compte, par `raw.githubusercontent.com` ; publier en un commit, par l'API Git.
6. Pour commencer, un jeton personnel limité au dépôt (Contents : lecture et écriture) ; OAuth par un petit relais plus tard.
7. Plusieurs magasins suivis, un seul où publier.
8. Un magasin commun à faustcode et faustmodular dès le départ (les modules sont des `.dsp`) ; faustdaw y trouve ses matériaux.
9. Un magasin garde les recettes et les matériaux qu'elles produisent, liés par des relations typées, vérifiables par empreinte ; l'index les recense dans les deux sens.
10. L'audio en FLAC dans le dépôt, sous 50 Mo par fichier, avec un aperçu Opus ; au-delà, et pour la vidéo, un lien.

Points ouverts :

- **Catégories** : se contenter des fonctions (`declare function`), ou permettre des dossiers de catégorie dans `modules/` ?
- **Préréglages** : publier des jeux de paramètres d'un module (`presets/`), avec la même identité par le contenu.
- **Évaluations** : les étoiles du dépôt, ou des réactions par élément (des *issues* ?), ou rien.
- **Licence** : imposer une licence au manifeste d'un magasin public, ou seulement la recommander.
- **Un index des magasins** chez GRAME, en plus du *topic*.
- **Les médias lourds** : *Releases* de GitHub, Git LFS, ou un hébergement extérieur.
- **Les gestes** : noter les réglages bougés pendant un enregistrement, pour que la recette le refasse.

# Phases \label{sec:phases}

Chaque phase est utile seule.

::: note [État]
Phase 1 livrée dans faustmodular 3.46.0 (`src/store/`) : suivre un magasin (`propriétaire/dépôt`, ou son adresse sur GitHub), ses modules dans la famille *Magasins* de la bibliothèque et dans la recherche, ses scènes dans Fichier ▸ Ouvrir depuis un magasin, les liens `?store=…&scene=…[&ref=…]`, `?scene=<adresse du fichier sur GitHub>` (\ref{sec:partager}) et `?store=…` ; l'index reconstruit depuis le dépôt quand il manque. Le modèle de magasin est dans `templates/fauststore/` du dépôt de faustmodular ; le dépôt modèle sur GitHub reste à créer.

Phase 2 livrée dans faustmodular 3.47.0 : *Mon magasin…* (le dépôt et son jeton, vérifiés) ; *Publier la scène dans mon magasin* (menu Fichier, avec confirmation si elle y est déjà) et *Publier dans mon magasin* (menu d'un module : son code, sans l'enveloppe) ; un commit par publication, l'index refait (les versions passées d'un module, avec leur commit), refait sur la branche si elle a bougé entre-temps ; le lien de partage, au commit publié, copié ; le magasin relu, à jour, avec le jeton. Restent pour plus tard : compléter les métadonnées d'un module au moment de le publier, l'aperçu d'une scène, retirer un élément.
:::

1. **Lire.** Ouvrir un magasin public (`propriétaire/dépôt`), le parcourir et y chercher (famille *Magasins* de la bibliothèque), placer un module, ouvrir une scène ; liens `?store=…&scene=…` ; index reconstruit depuis le dépôt s'il manque. Le dépôt modèle `fauststore-template`.
2. **Publier.** Le jeton et sa vérification ; publier un module et une scène en un commit ; l'index tenu à jour ; *Mon magasin* et les magasins suivis dans les réglages.
3. **Versions.** La provenance des instances ; les versions passées dans l'index ; le badge de mise à jour pour les modules d'un magasin ; ouvrir une version précise (`&ref=`).
4. **Découvrir et partager.** Le *topic* `fauststore` et la liste des magasins publics ; les aperçus de scènes ; faustcode sur le même magasin.
5. **Matériaux.** Enregistrer depuis le transport ; publier une scène et son enregistrement en un commit ; les relations dans l'index ; faustdaw lit les matériaux d'un magasin et remonte à leur recette.
6. **Plus tard.** OAuth par un relais ; contribuer par *fork* et *pull request* depuis l'application ; les bibliothèques Faust épinglées dans `libraries/` ; les préréglages.
