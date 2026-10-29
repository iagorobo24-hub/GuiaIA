# GuiaIA — ensayo de dos recursos, estados durables y diagnóstico

Fecha: 29 de octubre de 2026.
Rama: `feature/principal-enrollment-qa`.
**Estado: integración multirrecurso desarrollada, Fabric real PENDIENTE DE PASS.**

## Alcance

Se ha añadido un ensayo aislado `--multi-resource` que ejecuta, en
un mundo Fabric 1.21.1 desechable y solo loopback:

1. Extraer `oak_log` del bloque exactamente autorizado.
2. Extraer `birch_log` de un segundo bloque autorizado.
3. Depositar **un** `oak_log` en el cofre autorizado.
4. Depositar **un** `birch_log` en el mismo cofre.

El plan completo y cada depósito tienen firmas Ed25519 propias.
Los diarios impiden depositar antes de terminar ambas extracciones.
Se exige verificar cada inventario, los dos bloques, los cuatro recibos
durables, el orden, el regreso al cofre y la prohibición de avanzar
tras completar los cuatro pasos. No hay interfaz de chat ni ejecución
libre de acciones desde el modelo.

El arnés conserva las pruebas previas de una sola misión y de caída.
El escenario `--multi-resource` está separado de
`--crash-after-deposit`; nunca pueden activarse juntos.

## Resultados observados

- La última regresión Node completa *anterior a la nueva prueba*
  terminó con 298/298 PASS.
- El ensayo adicional con **diarios originales**, reabriendo la tarea
  tras la primera extracción y tras el primer depósito, pasó:
  10/10 tests de su módulo. Comprueba que no hay repetición ni pérdida
  de recibos entre límites seguros.
- **Primer ensayo Fabric multirrecurso**: extracción de roble con
  un recibo durable, segunda extracción incierta,
  diario `needs_review`, ningún depósito, salida 1.
- **Segundo ensayo Fabric multirrecurso**: volvió a registrar un
  recibo durable de roble, pero el diagnóstico del segundo paso devolvió
  `delivery_authority_lost_during_gather`, `dig_attempted=true`.
  El sistema bloqueó la repetición y dejó el diario en `needs_review`,
  sin depósito ni éxito falso, salida 1.

Se han observado retrasos del servidor de QA de varios segundos por
tick al entrar los clientes, mientras que el contrato de atestación
exige respuestas frescas durante la mutación del mundo.

## Preparación del siguiente ensayo

Para disminuir la carga *del laboratorio* sin tocar los permisos:

- Solo en modo multirrecurso: `view-distance=2` y
  `simulation-distance=2`.
- Tres segundos de estabilización tras preparar el mundo, antes de
  iniciar el cliente.
- Pausas de 900 ms entre los pasos firmados, que vuelven a autorizarse
  íntegramente en el momento de ejecutarse.
- Diagnósticos pasivos de los resultados internos de recolección y
  depósito, sin cambios en las barreras durables.

**Esta configuración revisada no se ha probado todavía en Fabric real.**
Otro agente volvió a iniciar su propia JVM de QA sobre Penguin; no se
ha interferido con ella ni se ha iniciado una instancia concurrente.
No se han extendido permisos, desactivado revocaciones ni modificado
los contratos del producto para satisfacer una prueba.

## Criterio de cierre pendiente

PASS real del escenario completo con 2 recepciones de recolección,
2 de depósito, bloque de roble y abedul ausentes, exactamente
`{oak_log:1,birch_log:1}` en el cofre y las cantidades iniciales
del jugador recuperadas. Hasta conseguirlo, la misión multirrecurso
**no debe considerarse validada en Minecraft**.

Teselia, el repositorio del otro agente y el despliegue permanecen
fuera del alcance. Sin push, merge ni PR.
