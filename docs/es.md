# Gaz de Bordeaux

Esta integración conecta Gladys con su **cuenta de cliente Gaz de Bordeaux**
([life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)). Lee allí su consumo
de **gas** y de **electricidad**, y su coste, para mostrarlos en Gladys,
dibujar sus gráficos y lanzar escenas.

Funciona por Internet (insignia **cloud**): nada que instalar en casa, ningún
módulo en el contador.

## Antes de empezar

- Necesita una cuenta en
  [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr) que muestre su
  consumo. Inicie sesión una vez desde un navegador para comprobarlo.
- Gaz de Bordeaux publica el consumo de un día **uno o dos días después** (lo
  que tarda el contador Gazpar o Linky en enviarlo). Gladys muestra por tanto
  siempre el **último día leído**, no el de hoy.
- Se necesita Gladys 5.1 o posterior.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Introduzca el **correo electrónico** y la **contraseña** de su cuenta de
   cliente.
3. Ajuste si hace falta:
   - **Intervalo de actualización (horas)**: frecuencia de lectura de la cuenta,
     cada 6 horas por defecto (de 1 a 24). Las lecturas solo cambian una vez al
     día: no sirve de nada bajar más.
   - **Días de historial a importar**: días pasados enviados a Gladys al crear
     un dispositivo, 30 por defecto (hasta 90), para que los gráficos no
     empiecen vacíos.
   - **Umbral de alerta gas / electricidad (kWh/día)**: por encima, se lanza el
     disparador «Consumo diario elevado». 0 lo desactiva.
4. Guarde. El botón **Probar la conexión** comprueba el correo y la contraseña
   y lista los contratos encontrados.
5. Abra la pestaña **Descubrimiento**: se ofrece un dispositivo **por
   contrato** («Gaz de Bordeaux – Gaz», «Gaz de Bordeaux – Électricité»).
   Añada los que quiera seguir.

La contraseña es un campo secreto: nunca se escribe en los registros.

## Lo que obtiene

Cada dispositivo «contrato» lleva sensores de solo lectura:

| Función                      | Unidad | Contrato     | Valor                                  |
| ---------------------------- | ------ | ------------ | -------------------------------------- |
| Consumo del día leído        | kWh    | todos        | un valor por día, fechado en ese día   |
| Coste del día leído          | €      | todos        | un valor por día, fechado en ese día   |
| Volumen de gas del día leído | m³     | gas          | un valor por día, fechado en ese día   |
| Consumo del mes              | kWh    | todos        | desde el día 1 del mes                 |
| Coste del mes                | €      | todos        | desde el día 1 del mes                 |
| Consumo del año              | kWh    | todos        | total del año dado por Gaz de Bordeaux |
| Coste del año                | €      | todos        | total del año dado por Gaz de Bordeaux |
| Consumo diario               | kWh    | electricidad | enviado al módulo Energía de Gladys    |

Los valores diarios están **fechados en el día que describen**, no en la hora
de lectura: el gráfico muestra el consumo del lunes en el lunes, aunque haya
llegado el miércoles.

Al crear un dispositivo, se importan los últimos días (ver **Días de historial
a importar**). Nunca se envían dos veces, ni siquiera tras un reinicio.

### La insignia de conexión

- **Cloud**: la última lectura ha funcionado.
- **Cloud con un punto naranja**: la cuenta responde, pero la última lectura
  tiene más de 4 días. Puede que el contador ya no envíe sus índices:
  compruébelo en el sitio de Gaz de Bordeaux.
- **Inaccesible**: la última lectura ha fallado (ver «Solución de problemas»).

## Acciones

- **Probar la conexión**: inicia sesión con el correo y la contraseña
  introducidos y lista los contratos encontrados.
- **Actualizar ahora**: lee la cuenta de cliente en el acto e indica el último
  día leído.

## Escenas

La integración añade sus tarjetas al editor de escenas, en **Integraciones**.

### Disparadores

- **Nueva lectura diaria**: Gaz de Bordeaux ha publicado un nuevo día. Filtre
  si quiere por contrato o energía. Las acciones siguientes pueden leer
  `{{triggerEvent.data.date}}`, `{{triggerEvent.data.kwh}}`,
  `{{triggerEvent.data.cost}}` y `{{triggerEvent.data.volume}}` (gas).
- **Consumo diario elevado**: el nuevo día supera el umbral de alerta definido
  en la configuración. Variables: `date`, `kwh`, `threshold`.
- **Cuenta de cliente inaccesible**: la lectura ha fallado cuando antes
  funcionaba. Filtre por la causa (inicio de sesión rechazado, solicitud
  bloqueada, red, respuesta inesperada, ningún contrato). Variables: `reason`,
  `message`.

Un día solo se anuncia una vez, incluso tras un reinicio. En la primerísima
lectura no se anuncia nada: solo los días siguientes.

### Acciones

- **Actualizar las lecturas de Gaz de Bordeaux**: lee la cuenta de cliente en
  el acto. Salidas: `success` y `contracts` (número de contratos leídos).
- **Obtener un consumo de Gaz de Bordeaux**: elija un contrato y un periodo
  (último día leído, este mes, este año). Salidas: `kwh`, `cost`, `volume`,
  `date` y `available` (falso si no hay datos). Útil para un mensaje «Ayer:
  42 kWh, 5,10 €».

Ejemplo: cada mañana a las 8, **Obtener un consumo** (último día leído) y
luego **Enviar un mensaje** «Gas del {{date}}: {{kwh}} kWh, {{cost}} €».

## Panel

Añada el widget **Consumo Gaz de Bordeaux** a un panel. Muestra:

- el consumo y el coste del último día leído y del mes;
- un gráfico de barras de los últimos 30 días;
- la energía, el último día leído, el volumen de gas, el total del año, la
  hora de la última lectura y el estado de la conexión;
- un botón **Actualizar**.

En los ajustes del widget, elija el contrato a mostrar; si se deja vacío, es
el primero.

## Solución de problemas

El mensaje de estado de la pestaña **Configuración** indica lo que falla:

- **Inicio de sesión rechazado**: el correo o la contraseña son incorrectos.
  Use los de [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr) y compruebe
  que puede iniciar sesión desde un navegador.
- **El sitio bloqueó la solicitud**: el sitio de Gaz de Bordeaux filtra a veces
  las solicitudes automáticas. La integración vuelve a intentarlo en la
  próxima actualización; si persiste, abra una incidencia en el repositorio de
  GitHub.
- **Inaccesible**: Gladys no tiene acceso a Internet o el sitio está caído.
- **Ningún contrato**: la cuenta no tiene contratos de gas ni de electricidad
  visibles.

Los registros de la integración (Gladys → Integraciones → Gaz de Bordeaux →
registros) dan el detalle. Nunca contienen la contraseña ni el token de sesión.

Esta integración no está publicada por Gaz de Bordeaux: lee los mismos datos
que su cuenta de cliente. Si el sitio cambia, puede dejar de funcionar hasta
una actualización.
