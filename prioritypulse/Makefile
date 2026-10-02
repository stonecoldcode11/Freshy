.PHONY: install backend frontend build serve test bench fuzz clean

PY := backend/.venv/bin/python

install:
	python3 -m venv backend/.venv
	backend/.venv/bin/pip install -q -r backend/requirements.txt
	cd frontend && npm install --no-audit --no-fund

backend:
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

serve: build
	cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000

test:
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npm run typecheck && npm test

bench:
	cd backend && .venv/bin/python scripts/benchmark.py --seeds 1-10

fuzz:
	cd backend && .venv/bin/python scripts/fuzz.py 1 80

clean:
	rm -rf frontend/dist frontend/node_modules backend/.venv backend/.pytest_cache
