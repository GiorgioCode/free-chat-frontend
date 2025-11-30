// Importamos los hooks necesarios de React.
// useEffect: Para ejecutar código cuando el componente se monta (iniciar conexión) o actualiza.
// useState: Para guardar datos que cambian (mensajes, input, estado de verificación).
// useRef: Para mantener una referencia a un elemento del DOM (usado para el scroll automático).
import { useEffect, useState, useRef } from 'react';

// Importamos la librería cliente de Socket.io.
import io from 'socket.io-client';

// Importamos los estilos CSS.
import './App.css';

// Configuramos la conexión con Socket.io de manera OPTIMIZADA.
// Es importante hacer esto FUERA del componente para no crear una nueva conexión
// cada vez que el componente se renderiza (lo cual pasa mucho en React).
const socket = io('https://free-chat-backend-pi.vercel.app/', {
  // Configuración de transportes: intentar WebSocket primero, luego polling como fallback.
  transports: ['websocket', 'polling'],

  // Configuración de reconexión automática.
  reconnection: true,            // Habilitar reconexión automática
  reconnectionDelay: 500,        // Esperar 500ms antes del primer intento
  reconnectionDelayMax: 5000,    // Máximo 5 segundos entre intentos
  reconnectionAttempts: Infinity, // Intentar reconectar indefinidamente

  // Configuración de timeout.
  timeout: 20000, // 20 segundos de timeout para la conexión inicial
});

// Generamos un ID de usuario aleatorio para esta sesión.
// Esto es solo para simular una identidad y saber cuáles mensajes son "míos".
// Math.random() genera un número, toString(36) lo convierte a base 36 (letras y números),
// y substring(7) toma una parte de esa cadena.
const MY_USER_ID = Math.random().toString(36).substring(7);

// Función auxiliar para generar un color NEÓN consistente basado en un texto (el ID del usuario).
// Esto asegura que el usuario "ABC" siempre tenga el mismo color, sin guardarlo en base de datos.
const stringToNeonColor = (str: string) => {
  let hash = 0;
  // Recorremos cada caracter del string para generar un número único (hash).
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Convertimos el hash en un valor de Matiz (Hue) para HSL (0 a 360 grados).
  const h = Math.abs(hash) % 360;
  // Retornamos un color HSL:
  // H (Matiz): calculado arriba.
  // S (Saturación): 100% para que sea muy vivo (neón).
  // L (Luminosidad): 60% para que sea brillante pero legible sobre negro.
  return `hsl(${h}, 100%, 60%)`;
};

// Definimos la estructura (interfaz) de un mensaje para TypeScript.
interface Message {
  text: string;     // El contenido del mensaje
  senderId: string; // El ID de quien lo envió
  id: string;       // Un ID único para el mensaje (para usar como 'key' en React)
  timestamp?: number; // Timestamp opcional (viene del servidor en sync)
}

// Interfaz para mensajes pendientes (en cola de reintento)
interface PendingMessage extends Message {
  retryCount: number;    // Número de intentos de reenvío
  timeout?: ReturnType<typeof setTimeout>; // Timer para el reintento
}

function App() {
  // Estado para el texto que el usuario está escribiendo en el input.
  const [message, setMessage] = useState('');

  // Estado para guardar la lista de todos los mensajes del chat. Es un array de objetos Message.
  const [messages, setMessages] = useState<Message[]>([]);

  // Estado para el número de usuarios conectados.
  const [userCount, setUserCount] = useState(0);

  // Estado para saber si el usuario ya confirmó que es mayor de edad.
  const [isVerified, setIsVerified] = useState(false);

  // Estado para saber si el usuario dijo que NO es mayor de edad.
  const [isUnderage, setIsUnderage] = useState(false);

  // Estado para el estado de conexión.
  const [isConnected, setIsConnected] = useState(socket.connected);

  // Referencia al final de la lista de mensajes para hacer scroll automático.
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ===== SISTEMA DE DEDUPLICACIÓN =====
  // Set para rastrear IDs de mensajes ya recibidos y evitar duplicados.
  const receivedMessageIds = useRef(new Set<string>());

  // ===== COLA DE MENSAJES PENDIENTES =====
  // Map para mantener mensajes que aún no se han confirmado (ACK).
  const pendingMessages = useRef(new Map<string, PendingMessage>());

  // Configuración de reintentos.
  const MAX_RETRIES = 3;
  const RETRY_TIMEOUT = 3000; // 3 segundos

  // Función para enviar un mensaje con reintentos y acknowledgment.
  const sendMessageWithRetry = (msgData: Message, retryCount = 0) => {
    console.log(`Sending message (attempt ${retryCount + 1}):`, msgData.id);

    // Emitimos el mensaje al servidor con un callback para el ACK.
    socket.emit('send_message', msgData, (ackResponse: any) => {
      console.log('ACK received:', ackResponse);

      if (ackResponse && ackResponse.success) {
        // Mensaje confirmado exitosamente
        pendingMessages.current.delete(msgData.id);
        console.log('Message confirmed:', msgData.id);
      } else {
        // Error del servidor
        console.error('Server error processing message:', ackResponse?.error);
        handleMessageFailure(msgData, retryCount);
      }
    });

    // Configuramos un timeout en caso de que no llegue el ACK.
    const timeout = setTimeout(() => {
      // Si después de RETRY_TIMEOUT no hemos recibido ACK, reintentamos.
      if (pendingMessages.current.has(msgData.id)) {
        console.warn(`No ACK received for message ${msgData.id}, retrying...`);
        handleMessageFailure(msgData, retryCount);
      }
    }, RETRY_TIMEOUT);

    // Guardamos el mensaje en pendientes con su timeout.
    pendingMessages.current.set(msgData.id, {
      ...msgData,
      retryCount,
      timeout
    });
  };

  // Función para manejar fallo de envío de mensaje.
  const handleMessageFailure = (msgData: Message, retryCount: number) => {
    const pending = pendingMessages.current.get(msgData.id);

    // Limpiamos el timeout anterior si existe.
    if (pending?.timeout) {
      clearTimeout(pending.timeout);
    }

    if (retryCount < MAX_RETRIES) {
      // Reintentamos enviar
      console.log(`Retrying message ${msgData.id} (${retryCount + 1}/${MAX_RETRIES})`);
      sendMessageWithRetry(msgData, retryCount + 1);
    } else {
      // Máximo de reintentos alcanzado, marcamos como fallido.
      console.error(`Message ${msgData.id} failed after ${MAX_RETRIES} attempts`);
      pendingMessages.current.delete(msgData.id);

      // Aquí podrías mostrar un indicador visual de error al usuario.
      // Por ahora solo lo logueamos en consola.
    }
  };

  // Función para enviar un mensaje.
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault(); // Evita que el formulario recargue la página.

    // Solo enviamos si hay texto (quitando espacios vacíos).
    if (message.trim()) {
      const newMessage: Message = {
        text: message,
        senderId: MY_USER_ID,
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}` // ID único
      };

      // Enviamos el mensaje con sistema de reintentos.
      sendMessageWithRetry(newMessage);

      // Limpiamos el input después de enviar.
      setMessage('');
    }
  };

  // useEffect principal: Configura los "listeners" (escuchadores) de eventos de Socket.io.
  useEffect(() => {
    // ===== EVENTOS DE CONEXIÓN =====

    // Cuando nos conectamos al servidor.
    socket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
    });

    // Cuando nos desconectamos del servidor.
    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    // Intentos de reconexión.
    socket.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnection attempt ${attempt}`);
    });

    // Cuando nos reconectamos exitosamente.
    socket.on('reconnect', (attemptNumber) => {
      console.log(`Reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
    });

    // ===== SINCRONIZACIÓN DE MENSAJES =====
    // Escuchamos cuando el servidor nos envía mensajes históricos al conectarnos.
    socket.on('sync_messages', (syncedMessages: Message[]) => {
      console.log(`Received ${syncedMessages.length} synced messages`);

      // Filtramos los mensajes que no hemos recibido antes (deduplicación).
      const newMessages = syncedMessages.filter(msg => {
        if (!receivedMessageIds.current.has(msg.id)) {
          receivedMessageIds.current.add(msg.id);
          return true;
        }
        return false;
      });

      if (newMessages.length > 0) {
        // Agregamos los nuevos mensajes al estado.
        setMessages(prev => [...prev, ...newMessages]);
      }
    });

    // ===== RECEPCIÓN DE MENSAJES =====
    // Escuchamos cuando el servidor nos envía un nuevo mensaje ('receive_message').
    socket.on('receive_message', (data: Message) => {
      // Deduplicación: solo procesamos si no lo hemos recibido antes.
      if (!receivedMessageIds.current.has(data.id)) {
        receivedMessageIds.current.add(data.id);

        // Actualizamos el estado de mensajes agregando el nuevo al final.
        setMessages((prev) => [...prev, data]);

        console.log('New message received:', data.id);
      } else {
        console.log('Duplicate message ignored:', data.id);
      }
    });

    // Escuchamos cuando el servidor nos actualiza el conteo de usuarios.
    socket.on('user_count', (count: number) => {
      setUserCount(count);
    });

    // Función de limpieza (cleanup): Se ejecuta si el componente se desmonta.
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect_attempt');
      socket.off('reconnect');
      socket.off('sync_messages');
      socket.off('receive_message');
      socket.off('user_count');

      // Limpiamos todos los timeouts pendientes.
      pendingMessages.current.forEach(pending => {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
      });
    };
  }, []);

  // useEffect secundario: Se ejecuta cada vez que cambia la lista de 'messages' o 'isVerified'.
  // Su función es hacer scroll automático hacia abajo para ver el último mensaje.
  useEffect(() => {
    if (isVerified) {
      // scrollIntoView hace que el elemento invisible al final de la lista sea visible.
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isVerified]);

  // Manejador para cuando el usuario dice que es menor de edad.
  const handleUnderage = () => {
    setIsUnderage(true);
  };

  // Renderizado condicional: Si es menor de edad, mostramos la pantalla de bloqueo.
  if (isUnderage) {
    return (
      <div className="underage-screen">
        <h1>ACCESS DENIED</h1>
        <p>We wait for you again when you are older.</p>
        <p>See you soon.</p>
      </div>
    );
  }

  // Renderizado condicional: Si no está verificado, mostramos el modal de edad.
  if (!isVerified) {
    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <h1>RESTRICTED ACCESS</h1>
          <p>
            Welcome to <strong>FREE CHAT</strong>.
          </p>
          <p>
            In this space, every user is assigned a unique neon color identity.
            This is a place for free expression.
          </p>
          <p className="warning-text">
            You must be 18 years or older to enter.
          </p>

          <div className="modal-actions">
            <button className="btn-deny" onClick={handleUnderage}>
              I am NOT over 18
            </button>
            <button className="btn-confirm" onClick={() => setIsVerified(true)}>
              I am over 18
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Renderizado principal: El chat.
  return (
    <div className="chat-container">
      {/* Cabecera del chat */}
      <div className="chat-header">
        <div>
          <h1>FREE CHAT</h1>
          <small>ANONYMOUS_USERS: {userCount}</small>
        </div>
        {/* Indicador de estado de conexión */}
        <span
          className="status-dot"
          style={{
            backgroundColor: isConnected ? '#00ff00' : '#ff0000',
            boxShadow: isConnected
              ? '0 0 10px #00ff00'
              : '0 0 10px #ff0000'
          }}
          title={isConnected ? 'Connected' : 'Disconnected'}
        ></span>
      </div>

      {/* Área donde se muestran los mensajes */}
      <div className="messages-area">
        {messages.map((msg) => {
          // Determinamos si el mensaje es mío comparando IDs.
          const isMine = msg.senderId === MY_USER_ID;
          // Calculamos el color neón basado en el ID del remitente.
          const neonColor = stringToNeonColor(msg.senderId);

          return (
            <div
              key={msg.id}
              // Clase dinámica para alinear a derecha (mío) o izquierda (otros).
              className={`message-wrapper ${isMine ? 'my-message' : 'other-message'}`}
            >
              <div
                className="message-bubble"
                style={{
                  // Estilos en línea para el color dinámico.
                  borderColor: neonColor, // Borde del color del usuario
                  color: neonColor,       // Texto del color del usuario (para máximo contraste neón)
                  // Sombra suave (glow) del mismo color.
                  boxShadow: `0 0 8px ${neonColor}40`
                }}
              >
                <span className="user-label">
                  {isMine ? '> ME' : `> ${msg.senderId}`}
                </span>
                {msg.text}
              </div>
            </div>
          );
        })}
        {/* Elemento invisible al final para anclar el scroll */}
        <div ref={messagesEndRef} />
      </div>

      {/* Área de input para escribir */}
      <form className="input-area" onSubmit={sendMessage}>
        <input
          type="text"
          placeholder="Type your message..."
          value={message}
          // Actualizamos el estado 'message' cada vez que el usuario escribe una letra.
          onChange={(event) => setMessage(event.target.value)}
          disabled={!isConnected} // Deshabilitamos input si no estamos conectados
        />
        <button type="submit" disabled={!isConnected}>SEND</button>
      </form>
    </div>
  );
}

export default App;
