// Prueba de carga normal: calienta de 5 a 50 peticiones/s y la mantiene 60 s.
// Uso:  k6 run loadtest/k6-normal.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: {
    carga_normal: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { target: 50, duration: '30s' }, // calentamiento (ramp up)
        { target: 50, duration: '60s' }, // carga sostenida
        { target: 0, duration: '5s' },   // bajada
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],     // menos de 1 % de errores
    http_req_duration: ['p(95)<500'],   // p95 menor de 500 ms
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
