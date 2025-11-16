import { useEffect, useRef, useState } from "react";
import "./App.css";

// 開発中: ローカル用
// 本番では wss://your-backend.onrender.com/ws などに差し替え
const WS_URL = "ws://localhost:8000/ws";

function App() {
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [nickname, setNickname] = useState("");

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");

  const [endReason, setEndReason] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [partnerNickname, setPartnerNickname] = useState(null);
  const [partnerTyping, setPartnerTyping] = useState(false);

  const wsRef = useRef(null);
  const messageListRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const typingTimeoutRef = useRef(null);

  // 各タブ固有のclientId
  const clientIdRef = useRef(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );

  const createId = () =>
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const isDisconnected = connectionStatus === "disconnected";
  const isConnecting = connectionStatus === "connecting";
  const isMatching = connectionStatus === "matching";
  const isChatting = connectionStatus === "chatting";

  // ============================
  // WebSocket接続
  // ============================
  const openWebSocket = () => {
    // 既存接続を確実に破棄
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
    }
    wsRef.current = null;

    if (!nickname.trim()) {
      alert("ニックネームを入力してください");
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    setConnectionStatus("connecting");
    setEndReason(null);
    setRoomId(null);
    setPartnerNickname(null);
    setMessages([]);
    setPartnerTyping(false);
    lastActivityRef.current = Date.now();

    ws.onopen = () => {
      setConnectionStatus("matching");

      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          isSystem: true,
          text: "接続中... 相手を探しています。",
        },
      ]);

      ws.send(
        JSON.stringify({
          type: "join",
          nickname: nickname.trim(),
          clientId: clientIdRef.current,
        })
      );
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      const type = data.type;

      if (type === "joined") {
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            isSystem: true,
            text: `${data.nickname} として待機キューに入りました。`,
          },
        ]);
        return;
      }

      if (type === "matched") {
        setConnectionStatus("chatting");
        setRoomId(data.roomId);
        setPartnerNickname(data.partnerNickname);
        setPartnerTyping(false);

        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            isSystem: true,
            text: `${data.partnerNickname} とマッチングしました。`,
          },
        ]);
        return;
      }

      if (type === "system") {
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            isSystem: true,
            text: data.text,
          },
        ]);
        return;
      }

      if (type === "chat") {
        const isSelf = data.clientId === clientIdRef.current;

        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            isSystem: false,
            isSelf,
            nickname: data.nickname,
            text: data.text,
          },
        ]);
        return;
      }

      if (type === "typing") {
        setPartnerTyping(data.isTyping);
        return;
      }

      if (type === "end") {
        let text = "チャットが終了しました。";

        if (data.reason === "self_ng") {
          text = "あなたが NG を選択しました。新しい相手を探します。";
        } else if (data.reason === "ng_by_partner") {
          text = "相手に NG されました。新しい相手を探します。";
        } else if (data.reason === "partner_disconnected") {
          text = "相手が切断しました。新しい相手を探します。";
        }

        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            isSystem: true,
            text,
          },
        ]);

        if (endReason === "manual") {
          setConnectionStatus("disconnected");
          return;
        }

        // 自動で再マッチング
        setTimeout(() => {
          openWebSocket();
        }, 50);

        return;
      }
    };

    ws.onerror = () => {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          isSystem: true,
          text: "WebSocket エラーが発生しました。",
        },
      ]);
    };

    ws.onclose = () => {
      if (endReason === "manual") {
        setConnectionStatus("disconnected");
        return;
      }
      setConnectionStatus("disconnected");
    };
  };

  // ============================
  // 操作系
  // ============================
  const handleConnect = () => {
    if (!isDisconnected) return;
    lastActivityRef.current = Date.now();
    openWebSocket();
  };

  const handleDisconnect = () => {
    setEndReason("manual");
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    } else {
      setConnectionStatus("disconnected");
    }
  };

  const handleSend = () => {
    if (!inputText.trim() || !isChatting) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          isSystem: true,
          text: "送信できません（接続されていません）。",
        },
      ]);
      return;
    }

    const text = inputText.trim();

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        text,
        clientId: clientIdRef.current,
      })
    );

    setInputText("");
    lastActivityRef.current = Date.now();
    wsRef.current?.send(JSON.stringify({ type: "stop_typing" }));
  };

  const handleInputKeyDown = (e) => {
    if (!isChatting) return;
    if (e.isComposing || e.nativeEvent?.isComposing) return;

    wsRef.current?.send(JSON.stringify({ type: "typing" }));
    lastActivityRef.current = Date.now();

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type: "stop_typing" }));
    }, 1000);

    // Shift+Enterで送信
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNg = () => {
    if (!isChatting) return;
    lastActivityRef.current = Date.now();
    wsRef.current?.send(JSON.stringify({ type: "ng" }));
  };

  // ============================
  // 無操作1分タイムアウト
  // ============================
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isChatting) return;
      const diff = Date.now() - lastActivityRef.current;
      if (diff > 60000) {
        wsRef.current?.send(JSON.stringify({ type: "timeout" }));
        setEndReason(null);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [isChatting]);

  // ============================
  // 自動スクロール
  // ============================
  useEffect(() => {
    if (messageListRef.current) {
      const el = messageListRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, partnerTyping]);

  const renderStatusLabel = () => {
    switch (connectionStatus) {
      case "disconnected":
        return "未接続";
      case "connecting":
        return "サーバー接続中";
      case "matching":
        return "マッチング中";
      case "chatting":
        return "チャット中";
      default:
        return connectionStatus;
    }
  };

  // ============================
  // JSX
  // ============================
  return (
    <div className="app">
      <header className="app-header">
        <h1>1対1チャット（プロトタイプ）</h1>
      </header>

      {/* 接続パネル */}
      <section className="connection-panel">
        <label>
          ニックネーム：
          <input
            type="text"
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              lastActivityRef.current = Date.now();
            }}
            disabled={!isDisconnected}
          />
        </label>

        <div className="connection-buttons">
          <button
            onClick={handleConnect}
            disabled={!isDisconnected || !nickname.trim()}
          >
            チャット開始
          </button>
          <button onClick={handleDisconnect} disabled={isDisconnected}>
            切断
          </button>
          <button onClick={handleNg} disabled={!isChatting}>
            NG
          </button>
        </div>

        <div className="connection-status">
          状態：<strong>{renderStatusLabel()}</strong>
          {endReason === "manual" && "（手動で終了）"}
        </div>
      </section>

      {/* チャットエリア */}
      <main className="chat-area">
        <div className="partner-info">
          {isChatting ? (
            <>
              相手：〈{partnerNickname ?? "相手"}〉
              {roomId && (
                <span className="room-id">
                  （Room: {roomId.slice(0, 8)}…）
                </span>
              )}
            </>
          ) : isMatching ? (
            "相手を探しています…"
          ) : isConnecting ? (
            "サーバーに接続中…"
          ) : (
            "まだ接続していません"
          )}
        </div>

        {isMatching && (
          <div className="matching-indicator">
            <div className="ring ring1" />
            <div className="ring ring2" />
            <div className="ring ring3" />
            <span className="matching-text">MATCHING...</span>
          </div>
        )}

        {/* コンソール風メッセージリスト */}
        <div className="message-list" ref={messageListRef}>
          {messages.map((msg) => {
            const cls = msg.isSystem
              ? "console-line system"
              : msg.isSelf
              ? "console-line self"
              : "console-line partner";

            return (
              <div key={msg.id} className={cls}>
                {msg.isSystem ? (
                  <>
                    <span className="console-prefix">--</span>
                    <span className="console-sep">&gt;</span>
                    <span className="console-text">{msg.text}</span>
                  </>
                ) : (
                  <>
                    <span className="console-name">{msg.nickname}</span>
                    <span className="console-sep">&gt;</span>
                    <span className="console-text">{msg.text}</span>
                  </>
                )}
              </div>
            );
          })}

          {partnerTyping && (
            <div className="console-line system">
              <span className="console-prefix">..</span>
              <span className="console-sep">&gt;</span>
              <span className="console-text">相手が入力中…</span>
            </div>
          )}
        </div>

        {/* 入力欄 */}
        <div className="input-area">
          <textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              lastActivityRef.current = Date.now();
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={
              isChatting
                ? "メッセージを入力...（Shift+Enterで送信）"
                : "接続中のみメッセージを送信できます"
            }
            disabled={!isChatting}
          />
          <div className="input-buttons">
            <button onClick={handleSend} disabled={!isChatting}>
              送信
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
