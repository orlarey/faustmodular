---
title: Les ressources d'une scène
subtitle: Des modules définis une fois par scène, édités dans faustcode par le système de fichiers du navigateur
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 16 novembre 2026
document-style: note-a4
language: fr
---

::: toc+
- **Objet** — pourquoi des ressources, pourquoi abandonner le lien par fenêtres.
- **Décisions prises** — les choix du 16 novembre 2026.
- **Le modèle** — ressource, provenance, instance ; les invariants.
- **Les gestes** — ajouter, dupliquer, rendre unique, renommer, éditer, mettre à jour.
- **Le stockage** — les ressources en fichiers nommés, le format 5.
- **Le contrat avec faustcode** — fichiers, verrous, canal, messages.
- **Le crayon** — ouvrir une ressource dans faustcode.
- **L'historique, l'export, les magasins** — ce que les ressources y changent.
- **La migration** — des instances aux ressources.
- **Ce qui disparaît**, **Hors périmètre**, **Décisions à valider**, **Critères d'acceptation**.
:::

# Objet

Aujourd'hui, chaque module d'une scène garde **sa propre copie** du code : quatre VCO identiques sont quatre codes, et en modifier un ne touche pas les trois autres. Le crayon d'un module l'envoie à faustcode par `postMessage`, entre deux fenêtres qui doivent se connaître (`src/FaustcodeLink.ts`). Ce lien est fragile : il désigne le module par un identifiant tiré au hasard à chaque chargement, et dépend de références de fenêtres qu'un rechargement ou un blocage de fenêtre fait perdre. En pratique, il ne fonctionne plus.

faustdaw sépare la **définition** d'un effet (`FxResource` : un nom, un code) de ses **instances** (`FxSlot` : une référence à la ressource et des valeurs de paramètres). Cette spécification fait de même pour faustmodular :

- une scène contient ses **ressources**, et ses modules sont des **instances** de ces ressources ;
- faustcode édite une **ressource**, qui est un fichier, et non une instance vivante ;
- les deux applications communiquent par le **système de fichiers du navigateur** (OPFS), qu'elles partagent, avec un `BroadcastChannel` qui ne sert que de sonnette.

faustcode suit la spécification compagne `spec_documents.md` (dépôt faustcode) : documents, origines, sans sessions. Une ressource de scène y est une **origine** comme une autre.

# Décisions prises

Le 16 novembre 2026 :

1. **Les ressources vivent dans la scène**, chacune avec une **provenance** facultative : module livré, module utilisateur, module d'un magasin.
2. **Les instances de la scène ouverte suivent leur ressource immédiatement.** Dans les autres scènes qui ont la même provenance, une pastille *mise à jour disponible* propose de l'appliquer.
3. **Rendre unique** donne à une instance sa propre ressource, pour qu'elle diverge.
4. **La communication passe par le système de fichiers.** Les fichiers portent les données, et un `BroadcastChannel` prévient que l'un a changé. Le lien par `postMessage` est supprimé.

# Le modèle

```adt
Document   ::= Doc(id, name, faust, generator, resources, instances, connections, io)
Resource   ::= Res(name, code, provenance)        (* name : unique dans la scène *)
Provenance ::= Builtin(path)                       (* module livré *)
             | User(moduleId, version)             (* module utilisateur, à cette version *)
             | Store(store, path, commit)          (* module d'un magasin, à ce commit *)
             | None                                (* écrite ici : déposée, nouvelle, rendue unique sans provenance *)
Instance   ::= Inst(id, resource, x, y, params, acc, modulations, view)   (* resource : un nom *)
```

**R1 — Le nom.** Le nom d'une ressource est unique dans la scène. Il est aussi le nom du groupe Faust de ses instances : `process = vgroup("<nom>", …)`, qui donne leurs adresses aux paramètres. Deux instances d'une même ressource ont donc les mêmes adresses, chacune avec ses propres valeurs.

**R2 — La référence.** Chaque instance désigne une ressource existante. Une ressource peut n'avoir aucune instance : elle reste alors au catalogue de la scène (voir les décisions à valider).

**R3 — Le code effectif.** Le code compilé d'une instance est le code de sa ressource, dans le groupe de son nom, plus les modulations de cette instance (`model/ModuleCode`, `model/Modulation`). Les modulations restent propres à chaque instance.

**R4 — Un changement, toutes les instances.** Quand le code d'une ressource change, toutes ses instances de la scène sont recompilées ensemble, sans couper le son :
- les valeurs des paramètres dont l'adresse existe encore sont gardées ;
- les connexions dont les ports existent encore sont gardées, les autres sont retirées et signalées, instance par instance.

C'est une seule étape de l'historique.

**R5 — Qui change une ressource.** Seuls ces gestes changent le code d'une ressource :
- un enregistrement dans faustcode ;
- *Mettre à jour* ;
- un fichier déposé sur l'une de ses instances ;
- l'annulation et le rétablissement.

# Les gestes

- **Ajouter un module** (menu Modules, ajout rapide, glisser) :
  - si la scène a déjà une ressource de même provenance et de même code, c'est une nouvelle instance de cette ressource ;
  - sinon, une nouvelle ressource est créée, avec un suffixe de nom si le nom est pris (`VCO-2`).
- **Dupliquer, copier-coller** dans la scène : de nouvelles instances de la même ressource. Coller dans une autre scène y copie la ressource : un même nom avec le même code est réutilisé, un même nom avec un autre code reçoit un suffixe.
- **Rendre unique** (menu d'une instance) : la ressource est copiée sous un nom libre (`VCO-2`), avec la même provenance, et seule cette instance passe à la copie. Ses paramètres sont renommés avec le groupe (`/VCO/…` → `/VCO-2/…`), valeurs et modulations comprises.
- **Renommer la ressource** (menu d'une instance) : toutes les instances changent de groupe, et leurs paramètres et modulations sont renommés de même. faustcode est prévenu (`resource-renamed`).
- **Éditer** : le crayon ouvre la **ressource** dans faustcode (voir Le crayon). Le titre de la fenêtre de faustcode et l'en-tête de son document le disent : `VCO.dsp — faustmodular ▸ Ma scène ▸ VCO`.
- **Déposer un fichier `.dsp`** sur la scène vide crée une ressource (provenance `None`) et une instance. Le déposer sur une instance remplace le code de **sa ressource**, donc de toutes ses instances (R4).
- **Mettre à jour** : une pastille sur les instances signale une ressource dont la provenance a une version plus récente :
  - un module utilisateur avec une nouvelle version ;
  - un magasin qui a publié un nouveau commit de ce module, connu à la dernière lecture du magasin ;
  - un module livré qui a changé.

  *Mettre à jour* applique la nouvelle version à la ressource : toutes ses instances suivent, et c'est une étape annulable.
- **La provenance suit les modules utilisateur**, comme dans `DOCUMENT-SPEC.md` :
  - éditer dans faustcode une ressource de provenance `Builtin` crée un module utilisateur du même nom, et la provenance devient `User` ;
  - chaque nouvel enregistrement en ajoute une version.

  Ainsi, les autres scènes qui utilisent ce module reçoivent la pastille (décision 2).

# Le stockage

```tree "Un document dans OPFS, format 5"
faustmodular/
  index.json                      inchangé : documents (id, name, trashed…), modules utilisateur
  documents/<uuid>/
    committed.json                copie validée : ressources (nom, empreinte, provenance), instances, connexions
    working.json                  copie de travail : la même chose, sans les codes des ressources
    resources/<Nom>.dsp           le code de travail de chaque ressource, toujours présent
  codes/<sha1>.dsp                inchangé : les codes des copies validées et de l'historique
```

- **Les fichiers de ressources sont l'état de travail.** `resources/<Nom>.dsp` contient le code de l'utilisateur, sans l'enveloppe, en UTF-8 avec des fins de ligne `\n`. Le fichier existe tant que la ressource existe, que le document soit modifié ou non. `working.json` ne contient pas ces codes : il les désigne par leur nom.
- **Le nom de fichier** est le nom de la ressource, où `/`, `\` et les caractères interdits par OPFS sont remplacés par `_`. La table nom ↔ fichier est dans `working.json` et `committed.json`.
- **Modifié (●)** : la copie de travail, c'est-à-dire `working.json` et les empreintes des fichiers de ressources, diffère de la copie validée. Un fichier de ressource réécrit par faustcode rend donc la scène modifiée, même si faustmodular n'est pas ouvert.
- **Enregistrer** dans faustmodular copie les codes des ressources dans `codes/` et écrit `committed.json`, qui les désigne par empreinte. **Revenir à la version enregistrée** réécrit les fichiers de ressources depuis `codes/`.
- **Le fichier exporté** (`.jfaust`, format 5) embarque le code de chaque ressource, et les instances désignent leur ressource par son nom.

# Le contrat avec faustcode

faustcode et faustmodular sont servis par la **même origine** (`orlarey.github.io`) : ils partagent OPFS, les verrous (Web Locks) et `BroadcastChannel`. Le contrat se limite à ceci.

**Ce que faustcode lit.**
- Dans `faustmodular/index.json`, les champs `id`, `name` et `trashed` des documents, et rien d'autre.
- Dans `faustmodular/documents/<uuid>/resources/`, la liste des fichiers `.dsp` et leur contenu.

**Ce que faustcode écrit.**
- Le contenu d'un fichier `resources/<Nom>.dsp` existant (Enregistrer).
- Un nouveau fichier `resources/<Nom>.dsp`, de nom libre (*Enregistrer sous… ▸ faustmodular*).
- Rien d'autre : ni `index.json`, ni `working.json`, ni `committed.json`, ni `codes/`.

**Les verrous.** Toute écriture d'un fichier de ressource, d'un côté comme de l'autre, se fait sous le verrou `faustmodular:document:<uuid>` (`navigator.locks`). Elle est **conditionnelle** : l'écrivain vérifie, sous le verrou, que le fichier a toujours l'empreinte qu'il a lue.
- Si ce n'est pas le cas, faustcode n'écrit pas et propose *Recharger* ou *Écraser*.
- faustmodular, lui, n'écrase jamais un fichier changé par un autre : il le lit comme un changement externe et l'applique (R4).

**Les ressources inconnues.** faustmodular adopte à l'ouverture de la scène, ou à la sonnette, tout fichier `resources/*.dsp` qu'il ne connaît pas : une nouvelle ressource, de provenance `None`. Si le message `resource-added` demande une instance (`place`), il en pose une au centre de la vue.

**La sonnette.** Après chaque écriture, l'écrivain envoie un message sur le canal `faustmodular-resources` :

| `type` | Émetteur | Champs | Effet chez l'autre |
| :-- | :-- | :-- | :-- |
| `resource-changed` | les deux | `document`, `name`, `sha1` | faustmodular relit le fichier et recompile les instances (R4) ; faustcode recharge son document s'il n'est pas modifié, sinon le bandeau |
| `resource-added` | faustcode | `document`, `name`, `sha1`, `place?` | faustmodular adopte la ressource, et pose une instance si `place` |
| `resource-renamed` | faustmodular | `document`, `from`, `to` | faustcode change l'origine de son document |
| `resource-removed` | faustmodular | `document`, `name` | le document de faustcode devient sans origine (bandeau) |
| `applied` | faustmodular | `document`, `name`, `sha1`, `ok`, `instances`, `error?` | faustcode affiche « VCO mis à jour (4 instances) », ou l'erreur |
| `open-resource` | faustmodular | `document`, `name`, `request` | un onglet faustcode ouvre le document de cette ressource |
| `opened` | faustcode | `request` | réponse à `open-resource` |

Chaque message porte `channel: "faustmodular-resources"` et `version: 1`. Un message mal formé est ignoré. Le canal ne transporte jamais de code : le code est dans le fichier.

**Ce que fait faustmodular à la sonnette.**
- **La scène est ouverte** dans l'onglet qui écrit (le second onglet d'un même document est en lecture seule, `DOCUMENT-SPEC.md`) : il relit le fichier, recompile les instances, ajoute l'étape à l'historique, marque la scène modifiée et répond `applied`.
- **La scène n'est pas ouverte** : il ne fait rien, et la scène lira le fichier à sa prochaine ouverture. faustcode, sans réponse `applied` au bout de 2 s, affiche « Enregistré dans Ma scène, qui n'est pas ouverte dans faustmodular ».
- **La compilation échoue dans faustmodular**, par exemple parce que l'environnement de bibliothèques de la scène diffère, ou que le module a plus de 32 canaux :
  - les instances continuent de jouer leur version précédente et sont marquées en erreur ;
  - `applied` porte l'erreur, que faustcode affiche ;
  - le fichier garde le nouveau code, ce qui permet de le corriger dans faustcode.

# Le crayon

1. faustmodular envoie `open-resource` sur le canal. Si un onglet faustcode répond `opened` dans les 500 ms, c'est lui qui ouvre la ressource. Si faustmodular a lui-même ouvert cette fenêtre, il la met au premier plan ; sinon il affiche « Ouvert dans l'onglet faustcode ».
2. Sans réponse, faustmodular ouvre `<faustcode>?open=faustmodular:<uuid>/<Nom>` dans une fenêtre nommée `faustcode`.
3. `<faustcode>` est `../faustcode/` relativement à faustmodular, donc `https://orlarey.github.io/faustcode/` en production. Le paramètre `?faustcode=<chemin>` est accepté s'il désigne la même origine. En développement, le serveur de faustmodular sert faustcode sous `/faustcode/` (`FAUSTCODE_DIR`), pour que les deux aient la même origine.
4. Le crayon d'une scène qui n'a pas encore d'identifiant de document (aucun document ouvert) est grisé. Ce cas n'existe pas avec les documents.

# L'historique, l'export, les magasins

- **L'historique** (`Scene.captureSnapshot`) contient les ressources : nom, empreinte et provenance. Annuler un changement de ressource réécrit son fichier (écriture conditionnelle) et sonne `resource-changed`. faustcode recharge alors son document s'il n'est pas modifié, et affiche le bandeau sinon.
- **L'export** `.jfaust` passe au format 5 (voir Le stockage). L'import lit les formats 1 à 4 avec la règle de migration.
- **Les magasins.** Publier une scène publie ses **ressources** comme modules, un module par ressource, quel que soit le nombre d'instances (`store/ScenePlan.ts`). Ouvrir une scène d'un magasin crée des ressources de provenance `Store`. Une nouvelle publication d'un module dans le magasin, connue à la lecture suivante, donne la pastille *Mettre à jour*.

# La migration

À l'ouverture d'un document de format 4, et à l'import d'un fichier de format 1 à 4 :

1. Les instances sont groupées par (nom, code). Chaque groupe devient une ressource, et la provenance vient du statut de son code (`DOCUMENT-SPEC.md`, « Le statut se déduit du contenu ») : `Builtin`, `User` ou `None`.
2. Deux groupes de même nom et de codes différents : le second, dans l'ordre des identifiants d'instance, devient `<Nom>-2`, le suivant `<Nom>-3`. Les paramètres et les modulations de leurs instances sont renommés avec le groupe.
3. Les fichiers `resources/<Nom>.dsp` sont écrits, et le document est réécrit au format 5, en copie validée comme en copie de travail. Un document propre reste propre.
4. La migration est idempotente. Elle ne change pas le son : chaque instance garde exactement son code effectif, au nom de groupe près pour les groupes renommés.

# Ce qui disparaît

- Le lien par fenêtres : `src/FaustcodeLink.ts`, les paramètres `?link=faustcode` et `?link=modular`, les messages `faustcode-link-*`.
- La copie du code par instance.
- *Open in faustcode* au menu d'un module d'un magasin. faustcode ouvre un magasin lui-même, et la ressource de la scène s'ouvre par le crayon.

# Hors périmètre

- Des ressources partagées en direct entre scènes : le partage passe par la provenance et la pastille.
- Le lien avec un faustcode d'une autre origine (un autre site, des ports différents en local).
- Des fichiers `.lib` propres à une scène : l'environnement de bibliothèques de la scène y pourvoit.
- Lister dans faustmodular les documents ouverts dans faustcode.

# Décisions à valider

1. **Le nom de la ressource est le nom du groupe Faust** de ses instances (R1). Renommer une ressource renomme les adresses de leurs paramètres.
2. **Une ressource sans instance reste au catalogue de la scène.** Une famille *Cette scène* du menu Modules la montre, et propose *Retirer de la scène*. Supprimer la dernière instance ne supprime donc pas la ressource, et un document faustcode qui l'édite reste valable.
3. **Ajouter un module réutilise une ressource** de même provenance et de même code.
4. **Un fichier déposé sur une instance remplace le code de sa ressource**, pour toutes ses instances.
5. **faustcode doit avoir la même origine.** Il n'y a pas de repli par `postMessage`.
6. **Le format 5** des documents et des fichiers exportés.

# Critères d'acceptation

Tests de bout en bout avec faustcode servi sous `/faustcode/` par le serveur de faustmodular (même origine), dans Chromium :

- [ ] Deux VCO ajoutés depuis le menu : une ressource, deux instances. Éditer la ressource dans faustcode et enregistrer : les deux instances sont recompilées, valeurs et connexions gardées ; faustcode affiche « VCO mis à jour (2 instances) ».
- [ ] *Rendre unique* sur l'un des deux : une ressource `VCO-2` ; éditer `VCO` ne touche plus l'autre instance.
- [ ] Enregistrer dans faustcode avec la scène fermée dans faustmodular : la scène s'ouvre ensuite avec le nouveau code, et elle est modifiée (●).
- [ ] Recharger faustcode, puis faustmodular, puis enregistrer dans faustcode : la ressource est mise à jour à chaque fois, sans recliquer sur le crayon.
- [ ] Cmd/Ctrl-Z dans faustmodular après une mise à jour : le fichier est réécrit, et faustcode recharge son document non modifié ; avec des modifications, le bandeau apparaît.
- [ ] Deux écritures concurrentes : faustcode écrit pendant que faustmodular a changé le fichier, et faustcode propose *Recharger* ou *Écraser* sans rien perdre.
- [ ] Un code qui compile dans faustcode mais pas dans faustmodular : les instances jouent l'ancienne version, et l'erreur revient à faustcode.
- [ ] *Enregistrer sous… ▸ faustmodular* depuis un document de faustcode : une ressource et une instance au centre de la vue de la scène ouverte.
- [ ] Le crayon, un onglet faustcode étant déjà ouvert : la ressource s'ouvre dans cet onglet, sans nouvelle fenêtre.
- [ ] Migration d'un document de format 4 avec deux `VCO` de codes différents : `VCO` et `VCO-2`, et chaque instance joue le même code qu'avant.
- [ ] Publier une scène de quatre instances de deux ressources publie deux modules.
- [ ] Renommer une ressource : les paramètres et les modulations suivent, et l'origine du document de faustcode change.

# Plan de réalisation

Livrée avec la refonte des documents de faustcode (`spec_documents.md`), dans le même ordre :

1. Le modèle des ressources (`model/Resources.ts`, pur, testé) : noms uniques, réutilisation, rendre unique, renommage des adresses, migration.
2. Le format 5 et le stockage : les fichiers de ressources, l'état modifié, Enregistrer, Revenir, et la migration du format 4.
3. La scène : les instances qui référencent une ressource, R4 sur toutes les instances, l'historique, *Mettre à jour*, la famille *Cette scène*.
4. Le contrat : les verrous, l'écriture conditionnelle, le canal, l'adoption des fichiers inconnus, le crayon.
5. L'export, les magasins (`ScenePlan`), la documentation. `FaustcodeLink.ts` est retiré.
