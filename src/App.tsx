// Importamos los hooks necesarios de React.
// useEffect: Para ejecutar código cuando el componente se monta (iniciar conexión) o actualiza.
// useState: Para guardar datos que cambian (mensajes, input, estado de verificación).
// useRef: Para mantener una referencia a un elemento del DOM (usado para el scroll automático).
import { useEffect, useState, useRef } from 'react';

// Importamos la librería cliente de Socket.io.
import io from 'socket.io-client';

// Importamos los estilos CSS.
import './App.css';

// Conectamos con el servidor Socket.io.
// Es importante hacer esto FUERA del componente para no crear una nueva conexión
// cada vez que el componente se renderiza (lo cual pasa mucho en React).
const socket = io('http://localhost:3001');

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

  // Referencia al final de la lista de mensajes para hacer scroll automático.
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Función para enviar un mensaje.
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault(); // Evita que el formulario recargue la página.

    // Solo enviamos si hay texto (quitando espacios vacíos).
    if (message.trim()) {
      const newMessage = {
        text: message,
        senderId: MY_USER_ID,
        id: Date.now().toString() // Usamos la fecha actual como ID simple.
      };

      // EMITIMOS el evento 'send_message' al servidor con los datos del mensaje.
      socket.emit("send_message", newMessage);

      // Limpiamos el input después de enviar.
      setMessage('');
    }
  };

  // useEffect principal: Configura los "listeners" (escuchadores) de eventos de Socket.io.
  // El array vacío [] al final significa que esto solo se ejecuta UNA vez al montar el componente.
  useEffect(() => {
    // Escuchamos cuando el servidor nos envía un nuevo mensaje ('receive_message').
    socket.on("receive_message", (data: Message) => {
      // Actualizamos el estado de mensajes agregando el nuevo al final.
      // Usamos la forma funcional setMessages((prev) => ...) para asegurarnos de tener la lista más reciente.
      setMessages((prev) => [...prev, data]);
    });

    // Escuchamos cuando el servidor nos actualiza el conteo de usuarios.
    socket.on("user_count", (count: number) => {
      setUserCount(count);
    });

    // Función de limpieza (cleanup): Se ejecuta si el componente se desmonta.
    // Es MUY importante apagar los listeners para no duplicar mensajes o causar fugas de memoria.
    return () => {
      socket.off("receive_message");
      socket.off("user_count");
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
        {/* Punto verde indicador de estado */}
        <span className="status-dot"></span>
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
        />
        <button type="submit">SEND</button>
      </form>
    </div>
  );
}

export default App;
