# Interactive 3D Portfolio

A modern, responsive Three.js portfolio with real-time material editing, smooth scrolling animations, and optimized performance.

## Features

- 🎨 **Interactive 3D Scene**: Full-screen Three.js canvas with 5 different mesh types
- 🎛️ **Material Editor**: Real-time PBR material property controls (albedo, metalness, roughness, etc.)
- 🎯 **Orbit Controls**: Smooth camera controls with damping and constraints
- 📱 **Responsive Design**: Mobile-first approach with Tailwind CSS
- ⚡ **Performance Optimized**: Lazy loading, code splitting, and Core Web Vitals optimization
- 🎬 **Smooth Scrolling**: Locomotive Scroll integration with GSAP animations
- 🎭 **Modern UI**: Glassmorphism design with Framer Motion animations

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **3D Graphics**: Three.js, React Three Fiber, React Three Drei
- **Animations**: GSAP, Framer Motion
- **Scrolling**: Locomotive Scroll
- **Styling**: Tailwind CSS v4
- **TypeScript**: Full type safety

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd three-starter
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Adding Your Assets

1. **Video File**: Replace `public/demo.mp4` with your MP4 video file
2. **Poster Image**: Replace `public/poster.jpg` with your video poster image
3. **3D Models**: Add GLTF models to the `public/models/` directory and update the mesh loading code

## Project Structure

```
src/
├── app/
│   ├── globals.css          # Global styles and UI components
│   ├── layout.tsx           # Root layout with metadata
│   ├── page.tsx             # Main page with sections
│   ├── ThreeCanvas.tsx      # 3D scene component
│   └── Navbar.tsx           # Navigation component
├── public/
│   ├── demo.mp4            # Video file (replace with your own)
│   ├── poster.jpg          # Video poster (replace with your own)
│   └── models/             # Add your GLTF models here
```

## Customization

### Adding New Meshes

1. Add your GLTF models to `public/models/`
2. Update the `MESHES` array in `ThreeCanvas.tsx`:
```typescript
const MESHES = [
  { name: 'Your Model', path: '/models/your-model.gltf' },
  // ... existing meshes
];
```

### Adding New Materials

Update the `MATERIALS` array in `ThreeCanvas.tsx`:
```typescript
const MATERIALS = [
  {
    name: 'Your Material',
    base: {
      color: '#your-color',
      metalness: 0.5,
      roughness: 0.3,
      // ... other properties
    }
  },
  // ... existing materials
];
```

### Styling

The project uses Tailwind CSS v4. Customize the design by:
- Modifying `src/app/globals.css` for global styles
- Updating the UI component classes in the components
- Adding new Tailwind classes for responsive design

## Performance Optimizations

- **Code Splitting**: Three.js libraries are split into separate chunks
- **Lazy Loading**: Video and images load only when needed
- **Memoization**: React components are memoized to prevent unnecessary re-renders
- **Bundle Optimization**: Webpack configuration optimizes bundle size
- **Core Web Vitals**: Optimized for LCP, FID, and CLS metrics

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## SEO Features

- Comprehensive meta tags
- Open Graph and Twitter Card support
- Structured data markup
- Mobile-first responsive design
- Fast loading times

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Deploy automatically

### Other Platforms

```bash
npm run build
npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For questions or issues, please open a GitHub issue or contact the maintainer.