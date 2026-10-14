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
- Gladys 5.1 ou plus récent est nécessaire.

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
