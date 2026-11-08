---
title: Recettes et matériaux
subtitle: Enregistrer une scène, la rappeler, rejouer ses enregistrements, construire par couches
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 8 novembre 2026
document-style: article-a4
language: fr
---

::: toc+
- **Objet** — la dualité recette / matériau, et ce qu'elle apporte.
- **Le graphe de provenance** — des matériaux, des scènes, des relations vérifiables.
- **Rappeler la scène d'un enregistrement** — la recette exacte, retrouvée et vérifiée.
- **Le module lecteur** — un matériau dans une scène, à sa place dans la ligne de temps.
- **Le rendu hors ligne** — un matériau sans temps réel, et la preuve de la reproductibilité.
- **L'environnement épinglé** — ce qu'il faut noter pour qu'une recette rejoue à l'identique.
- **Surfaces**, **Décisions et points ouverts**, **Phases**, **Critères**.
:::

Ce document complète `STORE-SPEC.md` (« Représentations et matériaux »), qui définit le format d'un matériau (`fauststore-material`), ses relations et ses médias, et `FAUST-SYNC-SPEC.md` (la ligne de temps en tics).

# Objet \label{sec:objet}

Un enregistrement est la **matérialisation** d'une scène : le résultat de son calcul, figé.

| | Recette (la scène) | Matériau (l'enregistrement) |
| :-- | :-- | :-- |
| Ce qu'on en fait | la modifier, en tirer des variantes | l'écouter, le monter, le transformer |
| Le coût d'une écoute | le calcul de la scène, à chaque fois | une lecture, quelle que soit la scène |
| Ce qu'il faut pour la jouer | faustmodular, libfaust, ses bibliothèques | un lecteur audio |

Garder les deux, **liés**, apporte deux choses.

1. **Le calcul devient une lecture, sans perdre la source.** Une scène lourde se rejoue au prix d'une lecture, et sa recette reste là pour une variante. Une scène trop lourde pour le temps réel peut même être **rendue hors ligne**, plus lentement que le temps réel s'il le faut, puis jouée comme un fichier : le matériau rend jouable ce qui ne l'était pas (\ref{sec:horsligne}).
2. **Le travail s'organise en couches.** Un matériau devient la matière d'une nouvelle scène, qui produit à son tour un matériau. Chaque couche peut être reprise et variée, sans refaire les autres.

C'est le principe des systèmes de construction reproductibles (une dérivation, son produit, l'empreinte qui les relie), et du *freeze* d'une piste dans une DAW, la source en plus.

# Le graphe de provenance \label{sec:graphe}

Les éléments d'un magasin et leurs relations forment un **graphe orienté sans cycle**. Chaque arc est vérifiable par une empreinte de contenu (SHA-1).

| Relation | De | Vers | Écrite dans | Empreinte |
| :-- | :-- | :-- | :-- | :-- |
| `recordingOf` | un matériau | la scène qui l'a produit | la fiche du matériau | `from.sha1` : le contenu de la scène |
| `uses` | une scène | un matériau qu'elle joue | la scène (son module lecteur) | `sha1` : le média |
| `derivedFrom` | une scène | la scène dont elle est une variante | la scène | `sha1` : le contenu de la scène d'origine |

Un exemple sur trois couches :

```
B.flac ──recordingOf──▶ S2 ──uses──▶ A.flac ──recordingOf──▶ S1
                         │
                         └──derivedFrom──▶ S2′ (une variante de S2, plus tard)
```

- **Déplier un matériau**, c'est remonter ce graphe : B a été produit par S2, qui jouait A, produit par S1. Chaque étape se rouvre et se vérifie.
- **L'index** recense les relations dans les deux sens : une scène connaît ses enregistrements (`recordings`, réalisé en 3.52.0), un matériau les scènes qui le jouent (`usedBy`), une scène ses variantes (`variants`).
- **Une relation peut viser un autre magasin** (`store`) : on construit sur les matériaux des autres.

# Rappeler la scène d'un enregistrement \label{sec:rappel}

**Le but.** Depuis un enregistrement, rouvrir **la scène exacte qui l'a produit**, telle qu'elle était au début de l'enregistrement, même si elle a été republiée depuis.

**Retrouver la version.** La fiche donne la scène par son chemin (`recordingOf`) et l'empreinte de son contenu (`from.sha1`). La scène et l'enregistrement ont été publiés dans **le même commit** (3.52.0). On cherche donc, dans l'ordre :

1. **La scène à la tête de la branche.** Si l'empreinte de son contenu est `from.sha1`, c'est elle.
2. **La scène au commit de la fiche.** C'est le commit qui a ajouté la fiche (`GET /repos/…/commits?path=<fiche>`, le plus ancien), donc celui de l'enregistrement.
3. **Les versions passées de la scène** (`commits?path=<scène>`), jusqu'à trouver l'empreinte.

Si aucune version ne correspond (un enregistrement ajouté à la main, ou une scène réécrite dans l'histoire), on le dit, et l'on propose la scène telle qu'elle est.

- **Ouvrir.** La scène s'ouvre comme un **nouveau document**, comme une scène ouverte depuis un magasin. Le document retient d'où il vient : le magasin, le chemin, le commit et l'empreinte. Une variante publiée ensuite porte `derivedFrom`.
- **Vérifier.** L'empreinte du contenu ouvert est comparée à `from.sha1`, et le message dit « la scène exacte de cet enregistrement » ou « une autre version de la scène ».
- **L'adresse.** `?recording=<adresse de la fiche, ou du média, sur GitHub>` rappelle la scène d'un enregistrement. C'est la forme de `?scene=`.

# Le module lecteur \label{sec:lecteur}

**Le but.** Jouer un matériau **dans** une scène, comme un module : la couche suivante.

- **Faust a ce qu'il faut.** La primitive `soundfile("label[url:{'…'}]", n)` donne au code les échantillons d'un fichier, que faustwasm charge depuis une adresse. Les fichiers bruts de GitHub permettent la lecture depuis une autre origine (CORS), et Chrome décode le FLAC.
- **À sa place dans la ligne de temps.** La fiche donne la position de l'enregistrement en tics (`timeline.startTick`, `lengthTicks`, `tempo`, `meter`). Le lecteur lit les entrées réservées de faust-sync (l'index, la marche, le départ). Il joue l'échantillon `k` du matériau quand la ligne de temps est au tic `startTick + k·inc/den`, c'est-à-dire **à l'échantillon près**, comme les Sync Clocks. Au tempo de l'enregistrement, c'est une lecture directe ; à un autre tempo, il joue à vitesse fixe depuis le début de la mesure (pas d'étirement en version 1).
- **Ses réglages** : le matériau (choisi dans un magasin), le gain, le décalage en mesures, la boucle sur sa longueur.
- **Sa trace** : la scène qui contient un lecteur porte la relation `uses` vers le matériau (son chemin et l'empreinte de son média). L'enregistrement d'une telle scène note `uses` à son tour, ce qui forme le graphe.
- **Hors ligne** : le lecteur se rend aussi hors ligne, puisque le fichier est chargé avant le rendu.

# Le rendu hors ligne \label{sec:horsligne}

**Le but.** Produire un matériau sans passer par le temps réel.

- **Le rendu.** La scène est reconstruite dans un `OfflineAudioContext` : mêmes modules, mêmes câbles, mêmes réglages, la ligne de temps jouée depuis le début d'une mesure, pour un nombre de mesures. Le rendu va aussi vite que le calcul le permet, plus vite ou plus lentement que le temps réel.
- **La reproductibilité.** Une scène **sans entrée vivante** (`live` vide) est déterministe. Deux rendus hors ligne de la même recette, dans le même environnement (\ref{sec:environnement}), donnent **les mêmes échantillons**. L'empreinte du média le prouve, et la fiche le note (`reproducible: true`, avec l'empreinte des échantillons rendus).
- **Le temps réel et le hors ligne.** Un enregistrement en temps réel d'une scène déterministe devrait coïncider avec son rendu hors ligne, à deux différences près : le retard d'un bloc des rebouclages en direct (`SCENE-FAUST-SPEC.md`, « Les écarts de sémantique »), et l'état des modules au début de l'enregistrement (ils tournaient avant). On le mesure ; on ne l'exige pas.

# L'environnement épinglé \label{sec:environnement}

Pour qu'une recette rejoue à l'identique **dans le temps**, il faut connaître :

| Ce qui change le son | Où c'est noté |
| :-- | :-- |
| le code de chaque module | dans la scène (son code, et son empreinte) |
| la version de libfaust | dans la fiche (`faust.libfaust`, à partir de 3.53.0) ; dans les documents (`DOCUMENT-SPEC.md`) |
| les bibliothèques Faust (`stdfaust.lib`…) | l'empreinte de leur environnement (`faust.libraries`) ; à publier dans `libraries/` (STORE-SPEC, phase 6) |
| le générateur de code de faustmodular (modulations…) | `generator` |
| la fréquence d'échantillonnage | `sampleRate` |

Rejouer une recette ancienne avec une version plus récente de libfaust ou des bibliothèques peut changer le son. Le rappel le signale quand les versions diffèrent ; les rejouer à l'identique demande les bibliothèques épinglées (plus tard).

# Surfaces \label{sec:surfaces}

**Dans faustmodular** :
- *Fichier ▸ Ouvrir depuis un magasin ▸ <magasin>* : les scènes, puis les enregistrements. Chaque enregistrement propose :
  - *Ouvrir sa scène* : le rappel ;
  - *Écouter* : le média dans un nouvel onglet ;
  - *Télécharger*.
- *Fichier ▸ Rendre hors ligne…* : un nombre de mesures, un fichier. Plus tard, un module *Lecteur* dans la bibliothèque.

**Dans faustdaw** : les matériaux d'un magasin comme pistes, posés à leur tic, avec un lien *Ouvrir la recette dans faustmodular* (`?recording=`).

# Décisions et points ouverts \label{sec:decisions}

Décisions proposées :

1. Les relations `recordingOf`, `uses` et `derivedFrom` forment un graphe sans cycle, vérifiable par empreintes ; l'index le lit dans les deux sens.
2. Le rappel retrouve la version exacte de la scène par l'empreinte de son contenu (tête, puis commit de la fiche, puis versions passées), et dit s'il l'a trouvée.
3. Le lecteur est un module Faust (`soundfile`), synchronisé sur faust-sync à l'échantillon près, sans étirement temporel en version 1.
4. Une scène sans entrée vivante est déterministe ; son rendu hors ligne le prouve par l'empreinte des échantillons.
5. La version de libfaust est notée dans la fiche dès maintenant ; les bibliothèques épinglées viendront avec `libraries/`.

Points ouverts :
- **L'étirement temporel** d'un matériau joué à un autre tempo (un module Faust de *time stretching*, ou un rééchantillonnage qui change la hauteur).
- **Les gestes** : noter les réglages bougés pendant un enregistrement, comme une automation, pour que la recette redevienne complète (`live: ["gestures"]`).
- **Les matériaux lourds** (au-delà de 50 Mo) : les *Releases* de GitHub, ou un autre hébergement.
- **Les aperçus** (Opus) pour l'écoute rapide.

# Phases \label{sec:phases}

::: note [État]
Phase 1 réalisée dans faustmodular 3.53.0 :
- **Le menu.** Les enregistrements apparaissent dans *Ouvrir depuis un magasin* (*Ouvrir sa scène*, *Écouter*, *Télécharger*).
- **Le rappel** (`src/store/Recall.ts`). La version exacte est retrouvée par l'empreinte : à la tête de la branche, au commit de l'enregistrement, ou dans l'historique de la scène. Le rappel signale aussi une autre version de libfaust.
- **Le lien.** `?recording=` rappelle la scène, et c'est le lien copié après une publication.
- **La fiche** note `faust.libfaust`.
- **Les tests.** Ils couvrent les quatre cas du rappel (la tête, la version de l'enregistrement après republication, l'historique, introuvable). Un test de bout en bout publie un enregistrement, republie la scène modifiée, puis rappelle la version de l'enregistrement par `?recording=`.
:::

::: note [État de la phase 2]
Réalisée dans faustmodular 3.54.0.
- **Le module.** *Ajouter comme lecteur* (`src/model/Player.ts`) fait un module dont le média est épinglé à un commit du magasin. Il lit le canal `bar` ajouté à la ligne de temps, et ses réglages sont *Bar*, *Loop* et *Gain*.
- **La trace.** La relation `uses` figure dans le code du lecteur, dans l'index (`uses`, `usedBy`) et dans la fiche d'un enregistrement.
- **Le critère, vérifié.** Un matériau de bruit joué par le lecteur, puis réenregistré sur sa mesure, redonne ses échantillons à un pas de 24 bits près.
- **Un écart corrigé en chemin.** Le lissage du gain (`si.smoo`) restait bloqué en flottant 32 bits à 0,99997 au lieu de 1, soit une erreur relative de ε/(1 − p). Il rejoint désormais sa cible exacte une fois proche.
:::

1. **Le rappel** (faustmodular 3.53.0) :
   - les enregistrements dans *Ouvrir depuis un magasin* (*Ouvrir sa scène*, *Écouter*, *Télécharger*) ;
   - la version exacte retrouvée et vérifiée ;
   - `?recording=` ;
   - la version de libfaust dans la fiche.
2. **Le lecteur** : le module, synchronisé ; `uses` dans la scène et dans l'index.
3. **Le rendu hors ligne** : le matériau rendu, `reproducible`.
4. **Les variantes** : `derivedFrom` à la publication d'une scène rappelée ; `variants` dans l'index.
5. **faustdaw** : les matériaux comme pistes, et le lien vers leur recette.

# Critères \label{sec:criteres}

**Le rappel :**
- [ ] Une scène publiée avec son enregistrement, puis republiée modifiée : *Ouvrir sa scène* rouvre la version de l'enregistrement, dont l'empreinte est `from.sha1`, et non la nouvelle.
- [ ] Un enregistrement dont la scène n'existe plus dans cette version : le rappel le dit, et propose la scène actuelle.
- [ ] `?recording=` avec l'adresse de la fiche ou du FLAC sur GitHub rouvre la même scène.

**Le lecteur :**
- [ ] Un matériau d'une mesure joué par le lecteur, puis réenregistré sur la même mesure, donne les mêmes échantillons (au gain près).

**Le rendu hors ligne :**
- [ ] Deux rendus hors ligne d'une scène déterministe ont la même empreinte.
