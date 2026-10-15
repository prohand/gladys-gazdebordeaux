# Gaz de Bordeaux

Cette intégration relie Gladys à votre **espace client Gaz de Bordeaux**
([life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)). Elle y lit votre
consommation de **gaz** et d'**électricité**, et son coût, pour les afficher
dans Gladys, tracer leurs graphiques et déclencher des scènes.

Elle passe par internet (badge **cloud**) : rien à installer chez vous, pas de
module sur le compteur.

## Avant de commencer

- Il vous faut un compte sur [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)
  et pouvoir y voir votre consommation. Connectez-vous-y une fois depuis un
  navigateur pour le vérifier.
- Gaz de Bordeaux publie la consommation d'une journée **un ou deux jours plus
  tard** (le temps que le compteur Gazpar ou Linky la remonte). Gladys affiche
  donc toujours le **dernier jour relevé**, pas aujourd'hui.
- Gladys 5.2 ou plus récent est nécessaire.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Renseignez l'**e-mail** et le **mot de passe** de votre espace client.
3. Réglez si besoin :
   - **Intervalle de rafraîchissement (heures)** : fréquence de lecture de
     l'espace client, toutes les 6 heures par défaut (de 1 à 24). Les relevés
     ne changent qu'une fois par jour : inutile de descendre plus bas.
   - **Jours d'historique à importer** : nombre de jours passés envoyés à
     Gladys à la création d'un appareil, 30 par défaut (jusqu'à 90). Les
     graphiques ne démarrent pas vides.
   - **Seuil d'alerte gaz / électricité (kWh/jour)** : au-dessus, le
     déclencheur « Consommation journalière élevée » se lance. 0 le désactive.
4. Enregistrez. Le bouton **Tester la connexion** vérifie l'e-mail et le mot
   de passe et liste les contrats trouvés.
5. Ouvrez l'onglet **Découverte** : un appareil est proposé **par contrat**
   (« Gaz de Bordeaux – Gaz », « Gaz de Bordeaux – Électricité »). Ajoutez ceux
   que vous voulez suivre.

Le mot de passe est un champ secret : il n'est jamais écrit dans les logs.

## Ce que vous obtenez

Chaque appareil « contrat » porte des capteurs en lecture seule :

| Fonctionnalité               | Unité | Contrat     | Valeur                                      |
| ---------------------------- | ----- | ----------- | ------------------------------------------- |
| Consommation du jour relevé  | kWh   | tous        | une valeur par jour, datée du jour concerné |
| Coût du jour relevé          | €     | tous        | une valeur par jour, datée du jour concerné |
| Volume de gaz du jour relevé | m³    | gaz         | une valeur par jour, datée du jour concerné |
| Consommation du mois         | kWh   | tous        | depuis le 1er du mois                       |
| Coût du mois                 | €     | tous        | depuis le 1er du mois                       |
| Consommation de l'année      | kWh   | tous        | total de l'année donné par Gaz de Bordeaux  |
| Coût de l'année              | €     | tous        | total de l'année donné par Gaz de Bordeaux  |
| Consommation journalière     | kWh   | électricité | envoyée au module Énergie de Gladys         |

Les valeurs journalières sont **datées du jour concerné**, pas de l'heure de
lecture : le graphique montre bien la consommation du lundi au lundi, même si
elle est arrivée le mercredi.

À la création d'un appareil, les derniers jours (voir **Jours d'historique à
importer**) sont importés. Ils ne sont jamais envoyés deux fois, même après
un redémarrage.

### Le badge de connexion

- **Cloud** : la dernière lecture a réussi.
- **Cloud avec un point orange** : l'espace client répond, mais le dernier
  relevé a plus de 4 jours. Le compteur ne remonte peut-être plus ses index :
  vérifiez-le sur le site de Gaz de Bordeaux.
- **Injoignable** : la dernière lecture a échoué (voir « En cas de problème »).

## Actions

- **Tester la connexion** : se connecte avec l'e-mail et le mot de passe
  saisis et liste les contrats trouvés.
- **Rafraîchir maintenant** : lit l'espace client tout de suite et indique
  le dernier jour relevé.
- **Mes prix de contrat** : calcule les prix réellement payés sur votre
  contrat d'électricité (voir « Contrats d'énergie »).

## Scènes

L'intégration ajoute ses cartes à l'éditeur de scènes, catégorie
**Intégrations**.

### Déclencheurs

- **Nouveau relevé journalier** : Gaz de Bordeaux a publié une nouvelle
  journée. Filtrez éventuellement sur un contrat ou une énergie. Les actions
  suivantes peuvent lire `{{triggerEvent.data.date}}`,
  `{{triggerEvent.data.kwh}}`, `{{triggerEvent.data.cost}}` et
  `{{triggerEvent.data.volume}}` (gaz).
- **Consommation journalière élevée** : la nouvelle journée dépasse le seuil
  d'alerte réglé dans la configuration. Variables : `date`, `kwh`,
  `threshold`.
- **Espace client injoignable** : la lecture a échoué alors qu'elle
  fonctionnait. Filtrez sur la cause (connexion refusée, requête bloquée,
  réseau, réponse inattendue, aucun contrat). Variables : `reason`,
  `message`.

Une journée n'est annoncée qu'une fois, même après un redémarrage. À la toute
première lecture, rien n'est annoncé : seules les journées suivantes le sont.

### Actions

- **Rafraîchir les relevés Gaz de Bordeaux** : lit l'espace client tout de
  suite. Sorties : `success` (réussi ou non) et `contracts` (nombre de
  contrats lus).
- **Lire une consommation Gaz de Bordeaux** : choisissez un contrat et une
  période (dernier jour relevé, ce mois-ci, cette année). Sorties : `kwh`,
  `cost`, `volume`, `date` et `available` (faux si aucune donnée). Pratique
  pour envoyer un message « Hier : 42 kWh, 5,10 € ».

Exemple : chaque matin à 8 h, **Lire une consommation** (dernier jour relevé)
puis **Envoyer un message** « Gaz du {{date}} : {{kwh}} kWh, {{cost}} € ».

## Tableau de bord

Ajoutez le widget **Consommation Gaz de Bordeaux** à un tableau de bord. Il
affiche :

- la consommation et le coût du dernier jour relevé et du mois ;
- un graphique en barres des 30 derniers jours ;
- l'énergie, le dernier jour relevé, le volume de gaz, le total de l'année,
  l'heure de la dernière lecture et l'état de la connexion ;
- un bouton **Rafraîchir**.

Dans les réglages du widget, choisissez le contrat à afficher ; laissé vide,
c'est le premier.

## Contrats d'énergie (électricité)

L'intégration ajoute des modèles de contrat à l'assistant de contrat de Gladys
(**Énergie** → contrat du compteur), pour que Gladys calcule le coût de votre
électricité au prix de Gaz de Bordeaux. Un modèle par offre et par option :

| Offre               | Prix                                                         | Modèles              |
| ------------------- | ------------------------------------------------------------ | -------------------- |
| NovaFixe Élec       | fixes 3 ans à la souscription, 10 % sous le tarif réglementé | Base, Heures creuses |
| NovaFixe Bonus Élec | comme NovaFixe, plus 100 € offerts la première année         | Base, Heures creuses |
| NovaFlex Élec       | indexés sur le tarif réglementé (TRV), kWh HT 5 % en dessous | Base, Heures creuses |

**Votre offre n'est pas dans la liste ?** (par exemple **Ecodigo Elec**, ou une
ancienne offre qui n'est plus vendue) : prenez un modèle de la même option
(Base ou Heures creuses), ou créez le contrat à la main dans Gladys, puis
saisissez les prix donnés par le bouton **Mes prix de contrat** ci-dessous.
Votre offre est écrite dans votre espace client, ligne « Votre tarif ».

### Vos prix : le bouton « Mes prix de contrat »

Une offre à prix fixe garde **le prix du jour de la souscription** : un
contrat signé il y a deux ans n'a pas les prix de la grille d'aujourd'hui. Le
bouton **Mes prix de contrat** (onglet **Configuration**) les calcule à
partir de **votre** espace client : pour chaque jour, Gaz de Bordeaux donne
les kWh et ce qu'ils ont coûté, l'intégration en déduit le prix du kWh
réellement payé (heures pleines et creuses séparées), l'abonnement mensuel,
la puissance et les heures creuses. Exemple :

> Électricité (6 kVA) : 0,18373 €/kWh, abonnement 15,87 €/mois. Calculé sur
> les 30 derniers jours de votre compte.

Ce sont des prix **TTC**, comme ceux affichés par Gaz de Bordeaux et comme
les contrats proposés par Gladys. Le site arrondit chaque jour au centime :
l'abonnement calculé peut différer d'un centime de celui de votre espace client.

Recopiez ces valeurs dans l'assistant de contrat de Gladys. Le prix payé est
aussi affiché dans le widget (ligne **Prix payé**).

Gladys ne permet pas à une intégration de remplir un contrat à votre place :
c'est pourquoi il faut les recopier une fois, puis à chaque changement de prix.

### Quand vos prix changent

Laissez la **date de fin** de votre contrat Gladys vide tant que vos prix ne
changent pas. Ils peuvent changer en cours de route : nouvelle grille (NovaFlex,
fin d'une période à prix fixe), ou taxe (accise, TVA) qui change le prix TTC.

Le bouton **Mes prix de contrat** repère ce changement dans vos relevés et
calcule alors les prix sur les seuls jours depuis. Exemple :

> Électricité (6 kVA) : 0,17112 €/kWh, abonnement 15,87 €/mois. Nouveaux prix
> depuis le 01/02/2027 : terminez votre contrat Gladys le 31/01/2027 et
> créez-en un nouveau à partir du 01/02/2027 avec ces prix.

1. Sur le contrat actuel, mettez la **date de fin** à la veille du changement.
2. Créez un **nouveau contrat** qui démarre le jour du changement, avec les
   nouveaux prix.

Les jours passés gardent ainsi leurs anciens prix. Ne modifiez pas les prix du
contrat existant : Gladys recalculerait tout l'historique depuis le début du
contrat avec le nouveau prix.

Quelques jours après le changement, les prix sont un peu moins précis (moins
de jours pour les calculer) : cliquez à nouveau une ou deux semaines plus
tard et corrigez le nouveau contrat si besoin. Le changement n'est repéré que
dans les jours relevés (**Jours d'historique à importer**, jusqu'à 90).

### Les prix par défaut : les grilles officielles

Les valeurs proposées par défaut sont celles des **grilles tarifaires
officielles** de Gaz de Bordeaux (prix TTC, ici celles du 1er octobre 2026).
Elles sont téléchargées chaque mois sur gazdebordeaux.fr : quand un prix
change, une nouvelle version de l'intégration propose les nouveaux prix pour
les contrats créés ensuite. Un contrat déjà créé garde ses prix : voir **Quand
vos prix changent**.

| Puissance | Abonnement / mois | NovaFixe : kWh Base | NovaFixe : HP / HC | NovaFlex : kWh Base | NovaFlex : HP / HC |
| --------- | ----------------- | ------------------- | ------------------ | ------------------- | ------------------ |
| 3 kVA     | 12,13             | 0,18373             | –                  | 0,19190             | –                  |
| 6 kVA     | 15,87             | 0,18373             | 0,19648 / 0,14669  | 0,19190             | 0,20536 / 0,15280  |
| 9 kVA     | 19,88             | 0,18233             | 0,19648 / 0,14669  | 0,19042             | 0,20536 / 0,15280  |
| 12 kVA    | 23,76             | 0,18233             | 0,19648 / 0,14669  | 0,19042             | 0,20536 / 0,15280  |
| 15 kVA    | 27,40             | 0,18233             | 0,19648 / 0,14669  | 0,19042             | 0,20536 / 0,15280  |
| 18 kVA    | 31,14             | –                   | 0,19648 / 0,14669  | –                   | 0,20536 / 0,15280  |
| 24 kVA    | 39,13             | –                   | 0,19648 / 0,14669  | –                   | 0,20536 / 0,15280  |
| 30 kVA    | 46,46             | –                   | 0,19648 / 0,14669  | –                   | 0,20536 / 0,15280  |
| 36 kVA    | 53,88             | –                   | 0,19648 / 0,14669  | –                   | 0,20536 / 0,15280  |

L'abonnement est le même pour les trois offres. NovaFixe Bonus Élec a les
prix de NovaFixe Élec.

### Bon à savoir

- **Base** fonctionne avec la consommation journalière que cette intégration
  envoie au module Énergie.
- **Heures creuses** a besoin d'une consommation à la **demi-heure** (un
  compteur Linky relevé toutes les 30 minutes par une autre intégration).
  Avec la seule consommation journalière, Gladys ne peut pas savoir quels kWh
  sont en heures creuses : n'utilisez pas ce modèle dans ce cas.
- **Le gaz n'est pas concerné** : les contrats d'énergie de Gladys ne
  couvrent que l'électricité. Le coût du gaz reste celui donné par Gaz de
  Bordeaux (fonctionnalités « Coût du jour relevé », « Coût du mois »…).

## En cas de problème

Le message d'état de l'onglet **Configuration** dit ce qui bloque :

- **Connexion refusée** : l'e-mail ou le mot de passe est faux. Utilisez ceux
  de [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr) et vérifiez que
  vous pouvez vous y connecter dans un navigateur.
- **Le site a bloqué la requête** : le site de Gaz de Bordeaux filtre parfois
  les requêtes automatiques. L'intégration réessaie au prochain
  rafraîchissement ; si cela dure, ouvrez une demande sur le dépôt GitHub.
- **Injoignable** : Gladys n'a pas accès à internet, ou le site est en panne.
- **Aucun contrat** : le compte n'a pas de contrat de gaz ou d'électricité
  visible.

Les logs de l'intégration (Gladys → Intégrations → Gaz de Bordeaux → logs)
donnent le détail. Ils ne contiennent jamais le mot de passe ni le jeton de
session.

Cette intégration n'est pas éditée par Gaz de Bordeaux : elle lit les mêmes
données que votre espace client. Si le site change, elle peut cesser de
fonctionner jusqu'à une mise à jour.
