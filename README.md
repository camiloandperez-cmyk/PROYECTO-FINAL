# Proyecto final: proxy inverso con Nginx y monitoreo con Prometheus y Grafana

Infraestructura containerizada con Docker Compose: un servidor **Nginx** que actúa como proxy inverso y balanceador de carga entre **3 instancias de un backend** (Flask + Gunicorn), monitoreada con **Prometheus**, **Grafana**, **Nginx Prometheus Exporter** y **cAdvisor**.

## Arquitectura

```
                    host (tu PC)
        :8080          :9090         :3000        :8081
          |              |             |            |
 +--------v--------------v-------------v------------v-----------+
 |                      red Docker: infra-net                   |
 |                                                              |
 |  Cliente --> [ nginx ] --Round Robin--> [ app1 ]             |
 |                 |  \                    [ app2 ]  /metrics   |
 |        stub_status   \                  [ app3 ]             |
 |                 v                          ^                 |
 |        [ nginx-exporter ]                  |                 |
 |                 ^                          |                 |
 |                 +--------[ prometheus ]----+---[ cadvisor ]  |
 |                                |                             |
 |                          [ grafana ]                         |
 +--------------------------------------------------------------+
```

| Servicio | Imagen | Puerto en el host | Función |
|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` | 8080 | Proxy inverso y balanceador (Round Robin) |
| `app1`, `app2`, `app3` | construida desde `backend/` | ninguno | Backends Flask; cada uno se identifica (`server 1`, `server 2`, `server 3`) y expone `/metrics` |
| `nginx-exporter` | `nginx/nginx-prometheus-exporter:1.4.2` | ninguno | Traduce `stub_status` de Nginx a formato Prometheus |
| `cadvisor` | `ghcr.io/google/cadvisor:0.56.2` | 8081 | CPU, memoria, red y disco de cada contenedor |
| `prometheus` | `prom/prometheus:v3.13.5` | 9090 | Recolecta y almacena las métricas (cada 5 s) |
| `grafana` | `grafana/grafana:12.4.0` | 3000 | Dashboards |

Los backends no publican puertos: solo se llega a ellos a través de Nginx. La red `infra-net` es una red Docker personalizada y los contenedores se encuentran por el nombre del servicio. Prometheus y Grafana guardan sus datos en los volúmenes `prometheus_data` y `grafana_data`.

## Estructura del proyecto

```
proyecto-final/
├── docker-compose.yml
├── .env.example                 (puertos alternativos si Windows reserva alguno)
├── backend/
│   ├── app.py                   (Flask + métricas Prometheus)
│   ├── requirements.txt
│   └── Dockerfile
├── nginx/nginx.conf             (proxy inverso, balanceo y stub_status)
├── prometheus/prometheus.yml    (targets)
├── grafana/
│   ├── provisioning/            (fuente de datos y dashboards automáticos)
│   └── dashboards/proyecto-final.json
└── loadtest/
    ├── k6-normal.js
    └── k6-saturacion.js
```

## Requisitos previos

- Docker Desktop (o Docker Engine) con Docker Compose v2. Compruébalo con `docker --version` y `docker compose version`.
- Unos 4 GB de memoria asignados a Docker (Prometheus, Grafana y cAdvisor suman cerca de 1 GB).
- [k6](https://k6.io/) instalado en tu equipo para las pruebas de carga:
  - Windows: `winget install k6 --source winget`
  - macOS: `brew install k6`
  - Linux: ver https://grafana.com/docs/k6/latest/set-up/install-k6/
- Los puertos 8080, 8081, 9090 y 3000 libres. En Windows, algunos puertos pueden estar reservados por el sistema: revisa con `netsh interface ipv4 show excludedportrange protocol=tcp`. Si hay conflicto, copia `.env.example` a `.env` y cambia los puertos.

## Cómo levantar la infraestructura

Desde la carpeta del proyecto:

```bash
docker compose up -d --build
docker compose ps
```

La primera vez construye la imagen del backend y descarga las demás. Cuando termine, todos los servicios deben aparecer como `Up` (y los backends como `healthy`).

## URLs de acceso

| Qué | URL |
|---|---|
| Aplicación a través de Nginx | http://localhost:8080 |
| cAdvisor | http://localhost:8081 |
| Prometheus | http://localhost:9090 |
| Grafana (dashboard del proyecto) | http://localhost:3000 |

Grafana entra sin usuario y con rol Admin; es una configuración solo para laboratorio local.

## Verificar el balanceo de carga

Abre http://localhost:8080 en el navegador y refresca varias veces: la respuesta cambia entre `server 1`, `server 2` y `server 3`.

Por consola, enviando 30 peticiones y contando cuántas atendió cada backend (cada uno debe atender 10):

PowerShell:

```powershell
1..30 | ForEach-Object { (curl.exe -sI localhost:8080 | Select-String 'X-Backend').Line } | Group-Object | Select-Object Name, Count
```

Bash:

```bash
for i in $(seq 1 30); do curl -sI localhost:8080 | grep X-Backend; done | sort | uniq -c
```

Para ver los logs de Nginx con el backend que atendió cada petición:

```bash
docker compose logs -f --tail 10 nginx
```

## Verificar que Prometheus recopila métricas

1. Abre http://localhost:9090/targets: deben aparecer **6 targets en estado UP** (`prometheus`, `app1`, `app2`, `app3`, `nginx-exporter` y `cadvisor`).
2. En la pestaña **Query**, prueba estas consultas:

| Consulta | Qué muestra |
|---|---|
| `up` | 1 si el target responde, 0 si no |
| `sum by (backend) (rate(flask_http_request_total[30s]))` | Peticiones por segundo de cada backend |
| `histogram_quantile(0.95, sum by (le, backend) (rate(flask_http_request_duration_seconds_bucket[30s])))` | Latencia p95 de cada backend (en segundos) |
| `rate(nginx_http_requests_total[30s])` | Peticiones por segundo en Nginx |
| `nginx_connections_active` | Conexiones activas en Nginx |
| `sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[30s]))` | Núcleos de CPU por contenedor |
| `container_memory_working_set_bytes{name!=""}` | Memoria por contenedor |

## Dashboard de Grafana

Se carga automáticamente al levantar Grafana (http://localhost:3000). Incluye: targets y backends arriba, peticiones por segundo en Nginx, conexiones activas, respuestas 5xx, peticiones por segundo por backend, latencia p95 por backend y CPU, memoria, red y disco por contenedor. Está configurado con rango de 15 minutos y actualización cada 5 s.

## Pruebas de carga con k6

Con la infraestructura levantada y desde la carpeta del proyecto:

```bash
k6 run loadtest/k6-normal.js
```

Carga normal: sube de 5 a 50 peticiones por segundo en 30 s y las mantiene 60 s. Mientras corre, observa el dashboard de Grafana y la gráfica de CPU en cAdvisor. Al final, k6 muestra el resumen con el p95 y el porcentaje de errores.

Prueba de saturación:

```bash
k6 run loadtest/k6-saturacion.js
```

Pide 80 peticiones por segundo a `/slow?ms=500` durante 60 s. Cada backend atiende 8 peticiones a la vez y cada una tarda 0,5 s, así que la capacidad teórica de los tres es 3 × 8 / 0,5 = **48 peticiones por segundo**. En el dashboard, las peticiones por segundo se estancan cerca de ese valor y la latencia p95 se dispara.

Si tu `k6` no está en el PATH o la app no está en `localhost:8080`, usa `k6 run -e BASE_URL=http://localhost:8800 loadtest/k6-normal.js`.

## Probar la tolerancia a fallos

Con la carga normal corriendo, apaga un backend y observa el dashboard:

```bash
docker compose stop app1
```

Las peticiones por segundo de `app1` caen a 0, los otros dos backends absorben el tráfico y `up{job="backends"}` de app1 pasa a 0, sin respuestas 5xx. Para volver a encenderlo:

```bash
docker compose start app1
```

## Detener y limpiar

```bash
docker compose down          # detiene y elimina los contenedores (los datos de Prometheus y Grafana se conservan)
docker compose down -v       # además elimina los volúmenes (se pierden los datos)
docker image rm proyecto-backend:1.0
```

## Solución de problemas

- **`forbidden by its access permissions` al levantar:** Windows reserva ese puerto. Copia `.env.example` a `.env`, quita el `#` de la línea del puerto afectado y elige otro número.
- **`no such host` al descargar imágenes:** problema de DNS de Docker Desktop. Reintenta el comando, o en Docker Desktop, Settings, Docker Engine, agrega `"dns": ["8.8.8.8", "1.1.1.1"]`.
- **Un target sale DOWN:** espera 10 s y revisa de nuevo; si sigue, mira `docker compose logs <servicio>`.
- **cAdvisor no muestra nombres de contenedor (solo identificadores):** pasa a veces en Docker Desktop; usa `docker stats` como alternativa.
- **Cambié `nginx.conf`:** aplica el cambio con `docker compose restart nginx`.
