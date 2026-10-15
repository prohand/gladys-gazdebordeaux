# Gaz de Bordeaux

Diese Integration verbindet Gladys mit Ihrem **Gaz de Bordeaux Kundenkonto**
([life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)). Sie liest dort Ihren
**Gas-** und **Stromverbrauch** samt Kosten, um sie in Gladys anzuzeigen, als
Diagramm darzustellen und Szenen auszulösen.

Sie arbeitet über das Internet (Abzeichen **Cloud**): nichts zu Hause zu
installieren, kein Modul am Zähler.

## Bevor Sie beginnen

- Sie brauchen ein Konto auf
  [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr), das Ihren Verbrauch
  anzeigt. Melden Sie sich einmal im Browser an, um es zu prüfen.
- Gaz de Bordeaux veröffentlicht den Verbrauch eines Tages **ein bis zwei Tage
  später** (so lange braucht der Gazpar- oder Linky-Zähler). Gladys zeigt daher
  immer den **letzten gelesenen Tag**, nicht heute.
- Gladys 5.2 oder neuer ist erforderlich.

## Konfiguration

1. Öffnen Sie den Reiter **Konfiguration** der Integration.
2. Geben Sie **E-Mail** und **Passwort** Ihres Kundenkontos ein.
3. Bei Bedarf anpassen:
   - **Aktualisierungsintervall (Stunden)**: wie oft das Kundenkonto gelesen
     wird, standardmäßig alle 6 Stunden (1 bis 24). Die Werte ändern sich nur
     einmal am Tag: kürzer bringt nichts.
   - **Zu importierende Tage**: vergangene Tage, die beim Anlegen eines Geräts
     an Gladys gesendet werden, standardmäßig 30 (bis 90), damit die Diagramme
     nicht leer beginnen.
   - **Gas-/Strom-Warnschwelle (kWh/Tag)**: darüber wird der Auslöser „Hoher
     Tagesverbrauch“ ausgelöst. 0 schaltet ihn ab.
4. Speichern. Die Schaltfläche **Verbindung testen** prüft E-Mail und Passwort
   und listet die gefundenen Verträge.
5. Öffnen Sie den Reiter **Entdeckung**: pro **Vertrag** wird ein Gerät
   angeboten („Gaz de Bordeaux – Gaz“, „Gaz de Bordeaux – Électricité“). Fügen
   Sie die gewünschten hinzu.

Das Passwort ist ein geheimes Feld: es wird nie in die Logs geschrieben.

## Was Sie erhalten

Jedes „Vertrag“-Gerät trägt schreibgeschützte Sensoren:

| Funktion                       | Einheit | Vertrag | Wert                                     |
| ------------------------------ | ------- | ------- | ---------------------------------------- |
| Verbrauch des gelesenen Tages  | kWh     | alle    | ein Wert pro Tag, auf diesen Tag datiert |
| Kosten des gelesenen Tages     | €       | alle    | ein Wert pro Tag, auf diesen Tag datiert |
| Gasvolumen des gelesenen Tages | m³      | Gas     | ein Wert pro Tag, auf diesen Tag datiert |
| Monatsverbrauch                | kWh     | alle    | seit dem 1. des Monats                   |
| Monatskosten                   | €       | alle    | seit dem 1. des Monats                   |
| Jahresverbrauch                | kWh     | alle    | Jahressumme laut Gaz de Bordeaux         |
| Jahreskosten                   | €       | alle    | Jahressumme laut Gaz de Bordeaux         |
| Tagesverbrauch                 | kWh     | Strom   | an das Energie-Modul von Gladys gesendet |

Tageswerte sind **auf den Tag datiert, den sie beschreiben**, nicht auf den
Zeitpunkt des Lesens: das Diagramm zeigt den Verbrauch vom Montag am Montag,
auch wenn er am Mittwoch ankam.

Beim Anlegen eines Geräts werden die letzten Tage importiert (siehe **Zu
importierende Tage**). Sie werden nie doppelt gesendet, auch nicht nach einem
Neustart.

### Das Verbindungsabzeichen

- **Cloud**: das letzte Lesen war erfolgreich.
- **Cloud mit orangem Punkt**: das Kundenkonto antwortet, aber der letzte Wert
  ist älter als 4 Tage. Der Zähler meldet vielleicht nicht mehr: prüfen Sie
  ihn auf der Website von Gaz de Bordeaux.
- **Nicht erreichbar**: das letzte Lesen ist fehlgeschlagen (siehe
  „Fehlerbehebung“).

## Aktionen

- **Verbindung testen**: meldet sich mit der eingegebenen E-Mail und dem
  Passwort an und listet die gefundenen Verträge.
- **Jetzt aktualisieren**: liest das Kundenkonto sofort und nennt den letzten
  gelesenen Tag.
- **Meine Vertragspreise**: zeigt die aktuellen Preise Ihrer Verträge, wie
  espaceclient.gazdebordeaux.fr sie angibt (siehe „Energieverträge“).

## Szenen

Die Integration fügt ihre Karten dem Szenen-Editor hinzu, unter
**Integrationen**.

### Auslöser

- **Neuer Tageswert**: Gaz de Bordeaux hat einen neuen Tag veröffentlicht.
  Optional auf einen Vertrag oder eine Energie filtern. Die folgenden Aktionen
  können `{{triggerEvent.data.date}}`, `{{triggerEvent.data.kwh}}`,
  `{{triggerEvent.data.cost}}` und `{{triggerEvent.data.volume}}` (Gas) lesen.
- **Hoher Tagesverbrauch**: der neue Tag liegt über der in der Konfiguration
  eingestellten Warnschwelle. Variablen: `date`, `kwh`, `threshold`.
- **Kundenkonto nicht erreichbar**: das Lesen ist fehlgeschlagen, nachdem es
  funktioniert hatte. Auf die Ursache filtern (Anmeldung abgelehnt, Anfrage
  blockiert, Netzwerk, unerwartete Antwort, kein Vertrag). Variablen:
  `reason`, `message`.
- **Vertragspreise geändert**: ein aktueller Preis auf
  espaceclient.gazdebordeaux.fr hat sich geändert (kWh, HT/NT oder
  Grundgebühr, brutto). Optional auf die Energie filtern. Variablen: `offer`,
  `kwh_price`, `peak_price`, `off_peak_price`, `subscription` und der
  bisherige Wert von jedem (`previous_kwh_price`…). Die Preise werden bei jeder
  Aktualisierung gelesen und so verglichen, wie die Website sie angibt: kein
  Fehlalarm durch Rundung. Die Meldung kommt, sobald die Website den neuen
  Preis zeigt.

Ein Tag oder eine Preisänderung wird nur einmal gemeldet, auch nach einem
Neustart. Beim allerersten Lesen wird nichts gemeldet: nur die folgenden
Änderungen.

Beispiel: **Vertragspreise geändert**, dann **Nachricht senden** „Neuer Preis
Gaz de Bordeaux: {{triggerEvent.data.kwh_price}} €/kWh (vorher
{{triggerEvent.data.previous_kwh_price}}), Grundgebühr
{{triggerEvent.data.subscription}} €/Monat“. Legen Sie dann einen neuen
Gladys-Energievertrag an (siehe „Wenn sich Ihre Preise ändern“).

### Aktionen

- **Gaz de Bordeaux Werte aktualisieren**: liest das Kundenkonto sofort.
  Ausgaben: `success` und `contracts` (Anzahl gelesener Verträge).
- **Gaz de Bordeaux Verbrauch abrufen**: Vertrag und Zeitraum wählen (letzter
  gelesener Tag, dieser Monat, dieses Jahr). Ausgaben: `kwh`, `cost`, `volume`,
  `date` und `available` (falsch, wenn keine Daten). Praktisch für eine
  Nachricht „Gestern: 42 kWh, 5,10 €“.

Beispiel: jeden Morgen um 8 Uhr **Verbrauch abrufen** (letzter gelesener Tag),
dann **Nachricht senden** „Gas am {{date}}: {{kwh}} kWh, {{cost}} €“.

## Dashboard

Fügen Sie das Widget **Gaz de Bordeaux Verbrauch** einem Dashboard hinzu. Es
zeigt:

- Verbrauch und Kosten des letzten gelesenen Tages und des Monats;
- ein Balkendiagramm der letzten 30 Tage;
- die Energie, den letzten gelesenen Tag, das Gasvolumen, den aktuellen Preis
  (von espaceclient), die Jahressumme, die Uhrzeit des letzten Lesens und den
  Verbindungszustand;
- eine Schaltfläche **Aktualisieren**.

Wählen Sie in den Widget-Einstellungen den anzuzeigenden Vertrag; leer
gelassen ist es der erste.

## Energieverträge (Strom)

Die Integration fügt dem Vertragsassistenten von Gladys (**Energie** → Vertrag
des Zählers) Vertragsvorlagen hinzu, damit Gladys die Kosten Ihres Stroms zu
den Preisen von Gaz de Bordeaux berechnet. Eine Vorlage pro Angebot und Option:

| Angebot             | Preise                                                                 | Vorlagen    |
| ------------------- | ---------------------------------------------------------------------- | ----------- |
| NovaFixe Élec       | 3 Jahre ab Vertragsabschluss fest, 10 % unter dem regulierten Tarif    | Base, HT/NT |
| NovaFixe Bonus Élec | wie NovaFixe, plus 100 € Bonus im ersten Jahr                          | Base, HT/NT |
| NovaFlex Élec       | an den regulierten Tarif (TRV) gebunden, kWh ohne Steuern 5 % darunter | Base, HT/NT |

**Ihr Angebot ist nicht in der Liste?** (zum Beispiel **Ecodigo Elec** oder ein
älteres, nicht mehr verkauftes Angebot): Wählen Sie die Vorlage **Mein
Vertrag** (unten), sie passt zu jedem Angebot. Ihr Angebot steht in Ihrem
Kundenkonto, Zeile „Votre tarif“.

### Am einfachsten: die Vorlage „Mein Vertrag“

Die Vorlage **Gaz de Bordeaux – Mein Vertrag (Preise des Kundenkontos)** nutzt
**Ihre eigenen Preise**, die die Integration auf
**espaceclient.gazdebordeaux.fr** liest (Zeile „Votre prix actuel“):

1. Wählen Sie in Gladys unter **Energie** → Vertrag des Gaz de Bordeaux
   Stromzählers diese Vorlage.
2. Nichts einzugeben: Die Integration gibt Gladys die gesamten Kosten, kWh
   (Base oder HT/NT) und Grundgebühr, für jedes Angebot (Ecodigo, NovaFixe,
   NovaFlex…).

Der Assistent zeigt keinen Preis und einen leeren Tarif (`"components": []`):
das ist normal, die Preise bleiben bei der Integration. Das Feld **vertragliche
Leistung** ist optional (nur zur Information): die Schaltfläche **Meine
Vertragspreise** nennt sie, wenn Sie es ausfüllen möchten. Gladys erlaubt
einer Integration nicht, den Assistenten für Sie auszufüllen.

Ändern sich Ihre Preise, bemerkt die Integration es bei der nächsten
Aktualisierung: Die neuen Preise gelten ab diesem Tag, vergangene Tage behalten
die alten. **Kein neuer Vertrag nötig.**

Ein mit der ersten Version dieser Vorlage angelegter Vertrag (mit einem Feld
„Grundgebühr pro Monat“) funktioniert weiter: die dort eingegebene Grundgebühr
wird einmal gezählt. Um sie zu entfernen, aktualisieren Sie den Vertrag im
Assistenten aus der Vorlage.

- Die Integration muss laufen: Gladys fragt sie nach dem Preis. Ist sie
  gestoppt, werden die Kosten bei ihrer Rückkehr berechnet.
- Tage vor dem ersten Lesen der Preise erhalten die ersten gelesenen Preise.
- **HT/NT** nur mit Tageswerten: Ein Tag wird nach seinem Anteil an
  Niedertarifstunden (8 von 24) aufgeteilt, eine Schätzung. Mit
  Halbstundenwerten (Linky) ist die Berechnung genau. Gibt das Kundenkonto
  Ihre Niedertarifzeiten nicht an, tragen Sie sie im Vertrag ein.
- Ein Stromvertrag pro Kundenkonto wird unterstützt (bei mehreren der erste).

### Ihre Preise: die Schaltfläche „Meine Vertragspreise“

Ein Festpreisangebot behält **den Preis des Abschlusstages**, ein indexiertes
Angebot (Ecodigo Elec) ändert sich mit Steuern und Markt: Ihr Preis ist nicht
unbedingt der der heutigen Preisliste. Die Schaltfläche **Meine
Vertragspreise** (Reiter **Konfiguration**) liest Ihre aktuellen Preise auf
**espaceclient.gazdebordeaux.fr** (gleiche E-Mail und gleiches Passwort),
Zeile „Votre prix actuel“ der Seite Ihres Vertrags, und gibt sie unverändert
an, ohne Berechnung. Beispiel:

> Strom, OFFRE ECODIGO ELEC 100% ÉLECTRICITÉ VERTE (BASE, 6 kVA):
> 0,160164 €/kWh, Grundgebühr 15,87 €/Monat.

Es sind Bruttopreise (inkl. MwSt. und Abgaben: CTA in der Grundgebühr,
Verbrauchsteuer im kWh-Preis), wie in den Verträgen von Gladys. Mit der
Vorlage **Mein Vertrag** wendet die Integration sie selbst an; mit einer
anderen Vorlage übernehmen Sie sie in den Vertragsassistenten von Gladys.

Kann das Kundenkonto nicht gelesen werden, sagt die Schaltfläche es: Übernehmen
Sie die Preise dann von der Seite Ihres Vertrags auf
espaceclient.gazdebordeaux.fr.

### Wenn sich Ihre Preise ändern

Mit der Vorlage **Mein Vertrag** ist für den kWh-Preis nichts zu tun (siehe
oben). Mit einer anderen Vorlage: Lassen Sie das **Enddatum** Ihres
Gladys-Vertrags leer, solange sich Ihre Preise nicht ändern. Sie können sich unterwegs ändern: neue Preisliste
(NovaFlex, Ecodigo Elec, Ende einer Festpreisperiode) oder eine Steuer
(Verbrauchsteuer, MwSt.), die den Bruttopreis ändert. Gaz de Bordeaux informiert Sie, ebenso der Szenen-Auslöser **Vertragspreise geändert**; die Schaltfläche **Meine Vertragspreise** gibt dann die neuen Preise an.

1. Setzen Sie beim aktuellen Vertrag das **Enddatum** auf den Tag vor der
   Änderung.
2. Legen Sie einen **neuen Vertrag** an, der am Tag der Änderung beginnt, mit
   den neuen Preisen.

So behalten die vergangenen Tage ihre alten Preise. Ändern Sie nicht die
Preise des bestehenden Vertrags: Gladys würde die gesamte Historie seit
Vertragsbeginn mit dem neuen Preis neu berechnen.

### Die Standardpreise: die offiziellen Preislisten

Die vorgeschlagenen Standardwerte sind die der **offiziellen Preislisten** von
Gaz de Bordeaux (brutto, hier die vom 1. Oktober 2026). Sie werden jeden Monat
von gazdebordeaux.fr geladen: ändert sich ein Preis, bietet eine neue Version
der Integration die neuen Preise für danach angelegte Verträge an. Ein bereits
angelegter Vertrag behält seine Preise: siehe **Wenn sich Ihre Preise ändern**.

| Leistung | Grundgebühr / Monat | NovaFixe: kWh Base | NovaFixe: HT / NT | NovaFlex: kWh Base | NovaFlex: HT / NT |
| -------- | ------------------- | ------------------ | ----------------- | ------------------ | ----------------- |
| 3 kVA    | 12,13               | 0,18373            | –                 | 0,19190            | –                 |
| 6 kVA    | 15,87               | 0,18373            | 0,19648 / 0,14669 | 0,19190            | 0,20536 / 0,15280 |
| 9 kVA    | 19,88               | 0,18233            | 0,19648 / 0,14669 | 0,19042            | 0,20536 / 0,15280 |
| 12 kVA   | 23,76               | 0,18233            | 0,19648 / 0,14669 | 0,19042            | 0,20536 / 0,15280 |
| 15 kVA   | 27,40               | 0,18233            | 0,19648 / 0,14669 | 0,19042            | 0,20536 / 0,15280 |
| 18 kVA   | 31,14               | –                  | 0,19648 / 0,14669 | –                  | 0,20536 / 0,15280 |
| 24 kVA   | 39,13               | –                  | 0,19648 / 0,14669 | –                  | 0,20536 / 0,15280 |
| 30 kVA   | 46,46               | –                  | 0,19648 / 0,14669 | –                  | 0,20536 / 0,15280 |
| 36 kVA   | 53,88               | –                  | 0,19648 / 0,14669 | –                  | 0,20536 / 0,15280 |

Die Grundgebühr ist bei allen drei Angeboten gleich. NovaFixe Bonus Élec hat
die Preise von NovaFixe Élec.

### Gut zu wissen

- **Base** funktioniert mit dem Tagesverbrauch, den diese Integration an das
  Energie-Modul sendet.
- **HT/NT** braucht einen **halbstündlichen** Verbrauch (ein Linky-Zähler, der
  von einer anderen Integration alle 30 Minuten gelesen wird). Mit dem
  Tagesverbrauch allein kann Gladys nicht wissen, welche kWh im Niedertarif
  lagen: verwenden Sie diese Vorlage dann nicht (die Vorlage **Mein Vertrag**
  gibt eine Schätzung).
- **Gas ist nicht betroffen**: die Energieverträge von Gladys gelten nur für
  Strom. Die Gaskosten bleiben die von Gaz de Bordeaux gelieferten (Funktionen
  „Kosten des gelesenen Tages“, „Monatskosten“…).

## Fehlerbehebung

Die Statusmeldung im Reiter **Konfiguration** sagt, was nicht stimmt:

- **Anmeldung abgelehnt**: E-Mail oder Passwort falsch. Verwenden Sie die von
  [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr) und prüfen Sie die
  Anmeldung im Browser.
- **Die Website hat die Anfrage blockiert**: die Website von Gaz de Bordeaux
  filtert manchmal automatische Anfragen. Die Integration versucht es bei der
  nächsten Aktualisierung erneut; hält es an, eröffnen Sie ein Issue im
  GitHub-Repository.
- **Nicht erreichbar**: Gladys hat keinen Internetzugang oder die Website ist
  ausgefallen.
- **Kein Vertrag**: das Konto hat keinen sichtbaren Gas- oder Stromvertrag.

Die Logs der Integration (Gladys → Integrationen → Gaz de Bordeaux → Logs)
geben Details. Sie enthalten nie das Passwort oder das Sitzungs-Token.

Diese Integration wird nicht von Gaz de Bordeaux herausgegeben: sie liest
dieselben Daten wie Ihr Kundenkonto. Ändert sich die Website, kann sie bis zu
einem Update ausfallen.
