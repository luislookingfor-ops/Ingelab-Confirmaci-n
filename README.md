# Sistema Web Dinámico de Confirmación de Asistencia - INGELAB 2026

Aplicación web moderna y dinámica con base de datos integrada (SQLite) y diseño corporativo oficial de **INGELAB** (Verde `#59A456`, Azul Marino `#2C3E7C`, Azul Clínico `#4079B8`).

---

## 🌟 Características Principales

### 🖥️ Frontend Dinámico y Reactivo
- **Identidad de Marca:** Diseñado con la paleta de colores oficial extraída del logo `f1.png`.
- **Contador Regresivo en Vivo:** Muestra los días, horas, minutos y segundos exactos para el evento del **13 de Noviembre de 2026**.
- **Formulario Inteligente:**
  - Validación de campos en tiempo real (correo, teléfono, requeridos).
  - Lógica condicional: Si no asiste, adapta el mensaje y oculta preguntas irrelevantes.
  - Gestión de acompañantes: Despliega dinámicamente el campo de nombre al activar el botón.
  - Selección interactiva de requerimientos dietéticos para el cóctel.
- **Efecto de Celebración:** Confetti animado al confirmar la asistencia.
- **Pase / Credencial Digital con Código QR:**
  - Generación de código único de entrada (ej: `ING-7YQT`).
  - Código QR generado al vuelo en el navegador.
  - Opción de imprimir o guardar como PDF.

### 🗄️ Backend y Base de Datos
- **Node.js + Express:** API REST veloz y ligera.
- **SQLite Integrado (`node:sqlite`):** Base de datos relacional local (`ingelab_evento.db`), sin necesidad de instalar servidores de base de datos externos pesados.
- **Panel Administrativo en Vivo:**
  - Métricas en tiempo real: Total registros, confirmados, declinados, aforo esperado.
  - Buscador inteligente por nombre, empresa, email o código.
  - Filtro por estado.
  - **Exportar a Excel (CSV con UTF-8 BOM):** Descarga inmediata con un solo clic.

---

## 🚀 Cómo Iniciar la Aplicación

### Opción 1: Con 1 Clic (Recomendada en Windows)
Haz doble clic sobre el archivo ejecutable:
```text
iniciar_servidor.bat
```
Se abrirá automáticamente el navegador en:
**http://localhost:3000**

---

### Opción 2: Desde la Terminal
```bash
npm start
```
Luego abre tu navegador en **http://localhost:3000**.

---

## 🌐 Cómo Publicarla en Internet para tus Invitados

Si deseas que cualquier invitado del país acceda desde su celular o computadora con un link público:

1. **En Render.com (Gratis):**
   - Sube esta carpeta a GitHub.
   - Conecta tu repositorio en [render.com](https://render.com) como *Web Service*.
   - Comando de inicio: `npm start`.
   - Obtendrás una URL pública: `https://ingelab-evento-2026.onrender.com`.

2. **En Railway.app:**
   - Despliegue automático en 2 clics con SQLite persistente.
