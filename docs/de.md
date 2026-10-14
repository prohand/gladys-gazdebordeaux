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
- Gladys 5.1 oder neuer ist erforderlich.

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

Ein Tag wird nur einmal gemeldet, auch nach einem Neustart. Beim allerersten
Lesen wird nichts gemeldet: nur die folgenden Tage.

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
- die Energie, den letzten gelesenen Tag, das Gasvolumen, die Jahressumme,
  die Uhrzeit des letzten Lesens und den Verbindungszustand;
- eine Schaltfläche **Aktualisieren**.

Wählen Sie in den Widget-Einstellungen den anzuzeigenden Vertrag; leer
gelassen ist es der erste.

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
