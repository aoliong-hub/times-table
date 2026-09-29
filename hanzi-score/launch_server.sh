#!/usr/bin/env bash
# ============================================================
# 启动「田字格小老师」汉字书写打分服务 (FastAPI)
#
# 默认后台起一个实例，端口 8360（可用 HANZI_PORT 覆盖）。
# 日志与 pid 写到 logs/<主机名>/server_<port>.{log,pid}：
# 本目录在多机共享的 NFS 盘上，各机器常起相同端口的同名服务，
# 不按主机名隔离的话 stop 会按对方机器的 pid 号杀错本机进程。
# 同类做法见 ../../yolo11_pose/launch_server.sh，约定见 code/CLAUDE.md。
#
# Usage:
#   bash launch_server.sh                 # 启动（后台）
#   bash launch_server.sh stop            # 停止本机实例
#   bash launch_server.sh restart
#   bash launch_server.sh status
#   bash launch_server.sh foreground      # 前台跑，Ctrl-C 退出，调试用
#
#   HANZI_PORT=8361 bash launch_server.sh          # 换端口
#
# 打分是纯本地的（找格子 / OCR 认字 / 几何比对），不调 LLM、不需要 API key。
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${HANZI_PORT:-8360}"
HOST="${HANZI_HOST:-0.0.0.0}"

LOG_DIR="$SCRIPT_DIR/logs/$(hostname -s)"
PID_DIR="$LOG_DIR"
LOG_FILE="$LOG_DIR/server_${PORT}.log"
PID_FILE="$PID_DIR/server_${PORT}.pid"

SERVER_PY="$SCRIPT_DIR/server/app.py"
# 用于 pgrep 兜底匹配：绑定到本目录的 app.py + 本端口，不会误伤别的服务
MATCH="${SERVER_PY}.*--port ${PORT}"

check_deps() {
    python3 -c "import fastapi, uvicorn, multipart, PIL" 2>/dev/null && return 0
    echo "[launch] 缺依赖，先装：pip install fastapi uvicorn python-multipart pillow"
    exit 1
}

do_status() {
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
        echo "[launch] 运行中 (pid=$(cat "$PID_FILE")) http://localhost:${PORT}/"
        return 0
    fi
    if pgrep -f "$MATCH" >/dev/null 2>&1; then
        echo "[launch] 运行中但 pidfile 丢了 (pid=$(pgrep -f "$MATCH" | tr '\n' ' '))"
        return 0
    fi
    echo "[launch] 未运行 (port=${PORT})"
    return 1
}

do_stop() {
    stopped=0
    # 1) 按 pidfile 精确停
    if [[ -f "$PID_FILE" ]]; then
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null; then
            echo "[launch] 已停止 server_${PORT} (pid=$pid)"
            stopped=$((stopped + 1))
        fi
        rm -f "$PID_FILE"
    fi
    # 2) 兜底：pidfile 丢失时按命令行匹配残留进程
    for pid in $(pgrep -f "$MATCH" 2>/dev/null || true); do
        if kill "$pid" 2>/dev/null; then
            echo "[launch] 已停止残留进程 (pid=$pid)"
            stopped=$((stopped + 1))
        fi
    done

    if [[ "$stopped" == "0" ]]; then
        echo "[launch] 没有找到正在运行的实例 (port=${PORT})。"
        return 0
    fi
    # 3) 等优雅退出，超时再 SIGKILL
    for _ in $(seq 1 10); do
        pgrep -f "$MATCH" >/dev/null 2>&1 || break
        sleep 1
    done
    if pgrep -f "$MATCH" >/dev/null 2>&1; then
        echo "[launch] 进程未响应 SIGTERM，执行 SIGKILL..."
        pkill -9 -f "$MATCH" 2>/dev/null || true
    fi
    echo "[launch] 共停止 ${stopped} 个进程。"
}

do_start() {
    check_deps
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
        echo "[launch] 端口 ${PORT} 已在运行 (pid=$(cat "$PID_FILE"))，跳过。"
        return 0
    fi
    mkdir -p "$LOG_DIR"
    echo "============================================"
    echo "  田字格小老师 - 汉字书写打分服务（纯本地）"
    echo "============================================"
    echo "Host/Port : ${HOST}:${PORT}"
    echo "Log       : ${LOG_FILE}"
    echo "============================================"
    nohup python3 "$SERVER_PY" --host "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &
    echo "$!" > "$PID_FILE" 2>/dev/null \
        || echo "[launch] 警告: pidfile 写入失败 ($PID_FILE)，stop 时按进程名匹配。"
    sleep 2
    if kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
        echo "[launch] 已后台启动。打开 http://localhost:${PORT}/"
        echo "[launch] 看日志: tail -f ${LOG_FILE}"
        echo "[launch] 停服务: bash $(basename "${BASH_SOURCE[0]}") stop"
        echo "[launch] 注意: 监听 ${HOST} 且没有任何登录认证，建议只在内网/本机使用。"
    else
        echo "[launch] 启动失败，日志尾部："
        tail -n 20 "$LOG_FILE" || true
        exit 1
    fi
}

case "${1:-start}" in
    start)      do_start ;;
    stop)       do_stop ;;
    restart)    do_stop; sleep 1; do_start ;;
    status)     do_status ;;
    foreground) check_deps; exec python3 "$SERVER_PY" --host "$HOST" --port "$PORT" ;;
    *)
        echo "Usage: bash $(basename "${BASH_SOURCE[0]}") {start|stop|restart|status|foreground}"
        exit 1
        ;;
esac
