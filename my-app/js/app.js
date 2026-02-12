// Initialize Lucide Icons
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initCustomCursor();
    initScrollAnimations();
    initMobileMenu();
    initSmoothScroll();
    initNavbarScroll();
    initContactForm();
    initSkillBars();
});

// Custom Cursor
function initCustomCursor() {
    const cursor = document.querySelector('.custom-cursor');
    const follower = document.querySelector('.custom-cursor-follower');
    
    if (!cursor || !follower) return;
    
    let mouseX = 0, mouseY = 0;
    let cursorX = 0, cursorY = 0;
    let followerX = 0, followerY = 0;
    
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (isTouchDevice) return;
    
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });
    
    // Smooth cursor animation
    function animate() {
        // Cursor follows mouse directly with slight delay
        cursorX += (mouseX - cursorX) * 0.2;
        cursorY += (mouseY - cursorY) * 0.2;
        
        // Follower follows with more delay
        followerX += (mouseX - followerX) * 0.1;
        followerY += (mouseY - followerY) * 0.1;
        
        cursor.style.left = cursorX + 'px';
        cursor.style.top = cursorY + 'px';
        follower.style.left = followerX + 'px';
        follower.style.top = followerY + 'px';
        
        requestAnimationFrame(animate);
    }
    
    animate();
    
    // Hover effects on interactive elements
    const interactiveElements = document.querySelectorAll('a, button, input, textarea, .project-card');
    
    interactiveElements.forEach(el => {
        el.addEventListener('mouseenter', () => {
            cursor.style.transform = 'translate(-50%, -50%) scale(1.5)';
            follower.style.transform = 'translate(-50%, -50%) scale(0.5)';
            follower.style.opacity = '0';
        });
        
        el.addEventListener('mouseleave', () => {
            cursor.style.transform = 'translate(-50%, -50%) scale(1)';
            follower.style.transform = 'translate(-50%, -50%) scale(1)';
            follower.style.opacity = '0.3';
        });
    });
}

// Scroll Animations using Intersection Observer
function initScrollAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                
                // If it's a skill bar section, animate the bars
                if (entry.target.querySelector('.skill-bar')) {
                    animateSkillBars(entry.target);
                }
            }
        });
    }, observerOptions);
    
    document.querySelectorAll('.reveal-text').forEach(el => {
        observer.observe(el);
    });
}

// Mobile Menu
function initMobileMenu() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileLinks = document.querySelectorAll('.mobile-link');
    
    if (!menuBtn || !mobileMenu) return;
    
    let isOpen = false;
    
    menuBtn.addEventListener('click', () => {
        isOpen = !isOpen;
        if (isOpen) {
            mobileMenu.classList.remove('translate-x-full');
            mobileMenu.classList.add('translate-x-0');
            menuBtn.innerHTML = '<i data-lucide="x" class="w-6 h-6"></i>';
        } else {
            mobileMenu.classList.remove('translate-x-0');
            mobileMenu.classList.add('translate-x-full');
            menuBtn.innerHTML = '<i data-lucide="menu" class="w-6 h-6"></i>';
        }
        lucide.createIcons();
    });
    
    // Close menu when clicking links
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            isOpen = false;
            mobileMenu.classList.remove('translate-x-0');
            mobileMenu.classList.add('translate-x-full');
            menuBtn.innerHTML = '<i data-lucide="menu" class="w-6 h-6"></i>';
            lucide.createIcons();
        });
    });
}

// Smooth Scroll for Anchor Links
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                const offsetTop = targetElement.offsetTop - 80; // Account for fixed navbar
                
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Navbar Scroll Effect
function initNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    
    let lastScroll = 0;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
        
        lastScroll = currentScroll;
    });
}

// Contact Form Handling
function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        
        // Loading state
        submitBtn.classList.add('loading');
        submitBtn.innerHTML = '<span class="inline-block animate-spin mr-2">⟳</span> Sending...';
        submitBtn.disabled = true;
        
        // Simulate form submission (replace with actual API call)
        setTimeout(() => {
            submitBtn.classList.remove('loading');
            submitBtn.innerHTML = '<span class="inline-block mr-2">✓</span> Message Sent!';
            submitBtn.classList.add('bg-green-600');
            
            setTimeout(() => {
                submitBtn.innerHTML = originalText;
                submitBtn.classList.remove('bg-green-600');
                submitBtn.disabled = false;
                form.reset();
            }, 2000);
        }, 1500);
    });
}

// Skill Bars Animation
function initSkillBars() {
    const skillBars = document.querySelectorAll('.skill-bar');
    
    const observerOptions = {
        threshold: 0.5
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const bars = entry.target.querySelectorAll('.skill-bar');
                bars.forEach(bar => {
                    const width = bar.style.width || bar.className.match(/w-\[(\d+%)\]/)?.[1] || '0%';
                    bar.style.setProperty('--width', width);
                    setTimeout(() => {
                        bar.classList.add('animate');
                    }, 100);
                });
            }
        });
    }, observerOptions);
    
    // Observe the skills section
    const skillsSection = document.getElementById('skills');
    if (skillsSection) {
        observer.observe(skillsSection);
    }
}

function animateSkillBars(container) {
    const bars = container.querySelectorAll('.skill-bar');
    bars.forEach((bar, index) => {
        setTimeout(() => {
            bar.classList.add('animate');
        }, index * 100);
    });
}

// Typing Effect (Optional - if you want to add it to hero)
function initTypingEffect() {
    const elements = document.querySelectorAll('.typing-effect');
    
    elements.forEach(el => {
        const text = el.getAttribute('data-text') || el.textContent;
        const speed = parseInt(el.getAttribute('data-speed')) || 100;
        
        el.textContent = '';
        el.classList.add('typing-cursor');
        
        let i = 0;
        const typeWriter = () => {
            if (i < text.length) {
                el.textContent += text.charAt(i);
                i++;
                setTimeout(typeWriter, speed);
            }
        };
        
        // Start typing when element is visible
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && i === 0) {
                    typeWriter();
                }
            });
        });
        
        observer.observe(el);
    });
}

// Performance: Pause animations when tab is not visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.body.classList.add('animations-paused');
    } else {
        document.body.classList.remove('animations-paused');
    }
});

// Add parallax effect to hero section (subtle)
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const parallaxElements = document.querySelectorAll('.parallax');
    
    parallaxElements.forEach(el => {
        const speed = el.getAttribute('data-speed') || 0.5;
        el.style.transform = `translateY(${scrolled * speed}px)`;
    });
});

// Console greeting
console.log('%c Portfolio Website ', 'background: #171717; color: #fafafa; padding: 8px 16px; border-radius: 4px; font-family: monospace;');
console.log('%cBuilt with passion and code ✨', 'color: #525252; font-style: italic;');